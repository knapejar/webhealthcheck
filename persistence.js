const fs = require('fs');
const path = require('path');

// Configuration for persistence
const DATA_DIR = path.join(__dirname, 'data');
const MAX_AGE_DAYS = 30; // Keep 30 days of data instead of 24 hours

// Ensure data directory exists
function ensureDataDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      console.log(`Created data directory: ${DATA_DIR}`);
    }
  } catch (error) {
    console.error('Failed to create data directory:', error.message);
  }
}

// Get file path for domain data
function getDomainFilePath(domain) {
  // Sanitize domain name for filename (replace invalid characters)
  const safeDomain = domain.replace(/[^a-zA-Z0-9.-]/g, '_');
  return path.join(DATA_DIR, `${safeDomain}.json`);
}

// Load history data for a specific domain
function loadDomainHistory(domain) {
  try {
    const filePath = getDomainFilePath(domain);
    
    if (!fs.existsSync(filePath)) {
      return [];
    }
    
    const data = fs.readFileSync(filePath, 'utf8');
    const history = JSON.parse(data);
    
    // Filter out old data (keep only last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
    const filteredHistory = history.filter(entry => 
      new Date(entry.timestamp) >= thirtyDaysAgo
    );
    
    console.log(`Loaded ${filteredHistory.length} history entries for ${domain}`);
    return filteredHistory;
    
  } catch (error) {
    console.error(`Failed to load history for ${domain}:`, error.message);
    return [];
  }
}

// Save history data for a specific domain
function saveDomainHistory(domain, history) {
  try {
    ensureDataDir();
    const filePath = getDomainFilePath(domain);
    
    // Filter out old data before saving
    const thirtyDaysAgo = new Date(Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
    const filteredHistory = history.filter(entry => 
      new Date(entry.timestamp) >= thirtyDaysAgo
    );
    
    fs.writeFileSync(filePath, JSON.stringify(filteredHistory, null, 2));
    
  } catch (error) {
    console.error(`Failed to save history for ${domain}:`, error.message);
  }
}

// Load all domain history data
function loadAllHistory(domains) {
  const historyMap = new Map();
  
  domains.forEach(domain => {
    const history = loadDomainHistory(domain);
    historyMap.set(domain, history);
  });
  
  return historyMap;
}

// Save all domain history data
function saveAllHistory(healthHistory) {
  for (const [domain, history] of healthHistory.entries()) {
    saveDomainHistory(domain, history);
  }
}

// Clean up old data files (optional maintenance function)
function cleanupOldData() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      return;
    }
    
    const files = fs.readdirSync(DATA_DIR);
    const thirtyDaysAgo = new Date(Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
    
    files.forEach(file => {
      const filePath = path.join(DATA_DIR, file);
      const stats = fs.statSync(filePath);
      
      if (stats.mtime < thirtyDaysAgo) {
        fs.unlinkSync(filePath);
        console.log(`Cleaned up old data file: ${file}`);
      }
    });
    
  } catch (error) {
    console.error('Failed to cleanup old data:', error.message);
  }
}

module.exports = {
  DATA_DIR,
  MAX_AGE_DAYS,
  ensureDataDir,
  loadDomainHistory,
  saveDomainHistory,
  loadAllHistory,
  saveAllHistory,
  cleanupOldData
};