// server.js - Node.js Express API Server for fetching Senate data
// Install dependencies: npm install express axios cheerio cors

const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for frontend access
app.use(cors());
app.use(express.json());

// Cache configuration
let cachedData = null;
let cacheTime = null;
const CACHE_DURATION = 3600000; // 1 hour in milliseconds

// Function to parse date strings from Wikipedia
function parseDate(dateStr) {
    // Handle various date formats from Wikipedia
    // Common formats: "January 3, 2021", "2021-01-03", "Jan 3, 2021"
    if (!dateStr) return null;
    
    // Clean the date string
    dateStr = dateStr.replace(/\[.*?\]/g, '').trim(); // Remove references like [1]
    dateStr = dateStr.replace(/\(.*?\)/g, '').trim(); // Remove parenthetical info
    
    // Try to parse the date
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
        console.log(`Failed to parse date: ${dateStr}`);
        return null;
    }
    
    return date.toISOString().split('T')[0]; // Return in YYYY-MM-DD format
}

// Function to determine party from party cell or class
function determineParty(partyText, rowClass = '') {
    const text = partyText.toLowerCase();
    const className = rowClass.toLowerCase();
    
    if (text.includes('democrat') || className.includes('democrat')) {
        return 'Democrat';
    } else if (text.includes('republican') || className.includes('republican')) {
        return 'Republican';
    } else if (text.includes('independent') || className.includes('independent')) {
        return 'Independent';
    }
    
    // Check for party abbreviations
    if (text === 'd' || text === 'dem') return 'Democrat';
    if (text === 'r' || text === 'rep' || text === 'gop') return 'Republican';
    if (text === 'i' || text === 'ind') return 'Independent';
    
    return 'Unknown';
}

// Function to fetch and parse Wikipedia data
async function fetchSenatorData() {
    try {
        // Check cache
        if (cachedData && cacheTime && (Date.now() - cacheTime < CACHE_DURATION)) {
            console.log('Returning cached data');
            return cachedData;
        }
        
        console.log('Fetching fresh data from Wikipedia...');
        
        // Fetch the Wikipedia page
        const response = await axios.get('https://en.wikipedia.org/wiki/List_of_current_United_States_senators', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        
        const $ = cheerio.load(response.data);
        const senators = [];
        
        // Find the main table with senator information
        // Wikipedia tables often have the class "wikitable sortable"
        const tables = $('table.wikitable.sortable');
        
        let senatorTable = null;
        
        // Find the correct table - usually the first large table with senator data
        tables.each((index, table) => {
            const headers = $(table).find('th').map((i, el) => $(el).text().trim().toLowerCase()).get();
            
            // Look for table with relevant headers
            if (headers.some(h => h.includes('senator') || h.includes('name')) &&
                headers.some(h => h.includes('state')) &&
                headers.some(h => h.includes('assumed office') || h.includes('since') || h.includes('term'))) {
                senatorTable = $(table);
                return false; // Break the loop
            }
        });
        
        if (!senatorTable) {
            // Try alternative selector for the senators table
            senatorTable = $('table').filter((i, el) => {
                const text = $(el).text();
                return text.includes('Senator') && text.includes('State') && text.includes('Party');
            }).first();
        }
        
        if (!senatorTable || senatorTable.length === 0) {
            throw new Error('Could not find senator table on Wikipedia page');
        }
        
        // Get header indices
        const headers = senatorTable.find('thead th, tr:first th').map((i, el) => 
            $(el).text().trim().toLowerCase()
        ).get();
        
        console.log('Found headers:', headers);
        
        // Find column indices
        let nameIndex = headers.findIndex(h => h.includes('senator') || h.includes('name'));
        let stateIndex = headers.findIndex(h => h.includes('state'));
        let partyIndex = headers.findIndex(h => h.includes('party'));
        let assumedOfficeIndex = headers.findIndex(h => 
            h.includes('assumed office') || h.includes('since') || h.includes('took office') || h.includes('term began')
        );
        
        // If we can't find headers, try common positions
        if (nameIndex === -1) nameIndex = 0;
        if (stateIndex === -1) stateIndex = 1;
        if (partyIndex === -1) partyIndex = 2;
        if (assumedOfficeIndex === -1) assumedOfficeIndex = headers.length - 2; // Often near the end
        
        console.log(`Column indices - Name: ${nameIndex}, State: ${stateIndex}, Party: ${partyIndex}, Assumed: ${assumedOfficeIndex}`);
        
        // Parse each row
        senatorTable.find('tbody tr').each((index, row) => {
            const cells = $(row).find('td');
            
            if (cells.length < 3) return; // Skip rows with too few cells
            
            // Extract senator name
            let name = $(cells[nameIndex]).text().trim();
            
            // Clean up name (remove footnotes, titles, etc.)
            name = name.replace(/\[.*?\]/g, '').trim();
            name = name.replace(/\(.*?\)/g, '').trim();
            
            // Skip if no name found
            if (!name || name.length < 3) return;
            
            // Extract state
            let state = $(cells[stateIndex]).text().trim();
            state = state.replace(/\[.*?\]/g, '').trim();
            
            // Convert full state names to abbreviations if needed
            if (state.length > 2) {
                // This would need a full state name to abbreviation mapping
                // For now, just take the first 2 characters if it's not already an abbreviation
                const stateAbbreviations = {
                    'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
                    'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
                    'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
                    'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
                    'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
                    'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
                    'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
                    'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
                    'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
                    'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
                    'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
                    'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV',
                    'wisconsin': 'WI', 'wyoming': 'WY'
                };
                
                const stateLower = state.toLowerCase();
                if (stateAbbreviations[stateLower]) {
                    state = stateAbbreviations[stateLower];
                }
            }
            
            // Extract party
            let party = 'Unknown';
            if (partyIndex >= 0 && cells[partyIndex]) {
                const partyText = $(cells[partyIndex]).text().trim();
                const rowClass = $(row).attr('class') || '';
                party = determineParty(partyText, rowClass);
            }
            
            // Extract assumed office date
            let assumedOffice = null;
            if (assumedOfficeIndex >= 0 && cells[assumedOfficeIndex]) {
                const dateText = $(cells[assumedOfficeIndex]).text().trim();
                assumedOffice = parseDate(dateText);
            }
            
            // Add senator to array if we have the minimum required info
            if (name && state) {
                senators.push({
                    name: name,
                    state: state.toUpperCase(),
                    party: party,
                    assumedOffice: assumedOffice || '2021-01-03' // Default for missing dates
                });
                
                console.log(`Added senator: ${name} (${state}) - ${party} - ${assumedOffice}`);
            }
        });
        
        // If we didn't find enough senators, try a different parsing approach
        if (senators.length < 50) {
            console.log(`Only found ${senators.length} senators, trying alternative parsing...`);
            
            // Alternative: Look for all links with title containing "senator"
            $('table').find('a[title*="senator" i], a[title*="Senator" i]').each((i, el) => {
                const name = $(el).text().trim();
                if (name && name.length > 3 && !senators.some(s => s.name === name)) {
                    // Try to find associated data
                    const row = $(el).closest('tr');
                    const cells = row.find('td');
                    
                    senators.push({
                        name: name,
                        state: 'Unknown',
                        party: 'Unknown',
                        assumedOffice: '2021-01-03'
                    });
                }
            });
        }
        
        console.log(`Successfully parsed ${senators.length} senators`);
        
        // Cache the data
        cachedData = senators;
        cacheTime = Date.now();
        
        return senators;
        
    } catch (error) {
        console.error('Error fetching senator data:', error);
        
        // Return sample data as fallback
        return getSampleData();
    }
}

// Sample data fallback
function getSampleData() {
    return [
        // Sample senators - this would be the fallback if Wikipedia fetch fails
        {name: "Chuck Schumer", state: "NY", party: "Democrat", assumedOffice: "1999-01-03"},
        {name: "Mitch McConnell", state: "KY", party: "Republican", assumedOffice: "1985-01-03"},
        {name: "Dick Durbin", state: "IL", party: "Democrat", assumedOffice: "1997-01-03"},
        {name: "John Thune", state: "SD", party: "Republican", assumedOffice: "2005-01-03"},
        {name: "Elizabeth Warren", state: "MA", party: "Democrat", assumedOffice: "2013-01-03"},
        {name: "Bernie Sanders", state: "VT", party: "Independent", assumedOffice: "2007-01-03"},
        {name: "Ted Cruz", state: "TX", party: "Republican", assumedOffice: "2013-01-03"},
        {name: "Amy Klobuchar", state: "MN", party: "Democrat", assumedOffice: "2007-01-03"},
        // ... Add more sample data as needed
    ];
}

// API Routes

// Get all current senators
app.get('/api/senators', async (req, res) => {
    try {
        const senators = await fetchSenatorData();
        res.json({
            success: true,
            count: senators.length,
            data: senators,
            cached: cachedData === senators,
            lastUpdated: cacheTime ? new Date(cacheTime).toISOString() : null
        });
    } catch (error) {
        console.error('Error in /api/senators:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch senator data',
            message: error.message
        });
    }
});

// Get senators who served longer than a specific date
app.get('/api/senators/tenure/:date', async (req, res) => {
    try {
        const targetDate = new Date(req.params.date);
        
        if (isNaN(targetDate.getTime())) {
            return res.status(400).json({
                success: false,
                error: 'Invalid date format. Use YYYY-MM-DD'
            });
        }
        
        const senators = await fetchSenatorData();
        const longerServing = senators.filter(senator => {
            const assumedDate = new Date(senator.assumedOffice);
            return assumedDate < targetDate;
        });
        
        res.json({
            success: true,
            date: req.params.date,
            totalSenators: senators.length,
            senatorsWithLongerTenure: longerServing.length,
            data: longerServing
        });
    } catch (error) {
        console.error('Error in /api/senators/tenure:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to process tenure data',
            message: error.message
        });
    }
});

// Get party breakdown
app.get('/api/senators/parties', async (req, res) => {
    try {
        const senators = await fetchSenatorData();
        
        const partyBreakdown = {
            Democrat: senators.filter(s => s.party === 'Democrat').length,
            Republican: senators.filter(s => s.party === 'Republican').length,
            Independent: senators.filter(s => s.party === 'Independent').length,
            Unknown: senators.filter(s => s.party === 'Unknown').length
        };
        
        res.json({
            success: true,
            total: senators.length,
            breakdown: partyBreakdown
        });
    } catch (error) {
        console.error('Error in /api/senators/parties:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get party breakdown',
            message: error.message
        });
    }
});

// Force refresh cache
app.post('/api/senators/refresh', async (req, res) => {
    try {
        // Clear cache
        cachedData = null;
        cacheTime = null;
        
        // Fetch fresh data
        const senators = await fetchSenatorData();
        
        res.json({
            success: true,
            message: 'Cache refreshed successfully',
            count: senators.length,
            lastUpdated: new Date(cacheTime).toISOString()
        });
    } catch (error) {
        console.error('Error in /api/senators/refresh:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to refresh data',
            message: error.message
        });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        status: 'API is running',
        cacheStatus: cachedData ? 'Cached' : 'No cache',
        cacheAge: cacheTime ? `${Math.floor((Date.now() - cacheTime) / 1000)} seconds` : 'N/A'
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('Available endpoints:');
    console.log('  GET  /api/senators - Get all senators');
    console.log('  GET  /api/senators/tenure/:date - Get senators with longer tenure than date');
    console.log('  GET  /api/senators/parties - Get party breakdown');
    console.log('  POST /api/senators/refresh - Force refresh cache');
    console.log('  GET  /api/health - Health check');
});
