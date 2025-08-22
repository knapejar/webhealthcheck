const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { config, addToHistory, loadDomainHistory, saveDomainHistory, loadAllPersistedData, healthHistory } = require('../index.js');

// Test directory for persistence testing
const testDataDir = '/tmp/test-data';
const originalPersistDataDir = config.persistDataDir;

async function testPersistenceBasic() {
  console.log('Testing basic persistence functionality...');
  
  // Set test data directory
  config.persistDataDir = testDataDir;
  
  // Clean up test directory
  if (fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }
  
  const testDomain = 'https://example.com';
  
  // Clear in-memory history
  healthHistory.clear();
  healthHistory.set(testDomain, []);
  
  // Add some history entries
  addToHistory(testDomain, 'healthy');
  addToHistory(testDomain, 'unhealthy');
  addToHistory(testDomain, 'healthy');
  
  // Verify data was persisted
  const persistedData = loadDomainHistory(testDomain);
  assert.strictEqual(persistedData.length, 3, 'Should have persisted 3 entries');
  assert.strictEqual(persistedData[0].status, 'healthy', 'First entry should be healthy');
  assert.strictEqual(persistedData[1].status, 'unhealthy', 'Second entry should be unhealthy');
  assert.strictEqual(persistedData[2].status, 'healthy', 'Third entry should be healthy');
  
  // Verify file exists
  const fileName = testDomain.replace(/[^a-zA-Z0-9.-]/g, '_') + '.json';
  const filePath = path.join(testDataDir, fileName);
  assert(fs.existsSync(filePath), 'Persistence file should exist');
  
  console.log('✅ Basic persistence test passed');
}

async function testPersistenceRetention() {
  console.log('Testing persistence data retention...');
  
  // Set test data directory
  config.persistDataDir = testDataDir;
  
  const testDomain = 'https://test.com';
  
  // Create test data with old and new entries
  const now = new Date();
  const twoMonthsAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000); // 60 days ago
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 1 week ago
  
  const testData = [
    { timestamp: twoMonthsAgo.toISOString(), status: 'healthy' }, // Should be filtered out
    { timestamp: oneWeekAgo.toISOString(), status: 'unhealthy' }, // Should be kept
    { timestamp: now.toISOString(), status: 'healthy' } // Should be kept
  ];
  
  // Save test data directly
  saveDomainHistory(testDomain, testData);
  
  // Load and verify filtering
  const loadedData = loadDomainHistory(testDomain);
  assert.strictEqual(loadedData.length, 2, 'Should filter out entries older than 1 month');
  assert.strictEqual(loadedData[0].status, 'unhealthy', 'First entry should be from one week ago');
  assert.strictEqual(loadedData[1].status, 'healthy', 'Second entry should be from now');
  
  console.log('✅ Persistence retention test passed');
}

async function testPersistenceErrorHandling() {
  console.log('Testing persistence error handling...');
  
  // Test with invalid directory path (should not throw)
  config.persistDataDir = '/invalid/path/that/does/not/exist';
  
  const testDomain = 'https://errortest.com';
  
  // These should not throw errors
  addToHistory(testDomain, 'healthy'); // Should handle save error gracefully
  const loadedData = loadDomainHistory(testDomain); // Should handle load error gracefully
  
  // Should return empty array on load error
  assert.strictEqual(loadedData.length, 0, 'Should return empty array on load error');
  
  console.log('✅ Persistence error handling test passed');
}

async function testLoadAllPersistedData() {
  console.log('Testing loading all persisted data...');
  
  // Restore test data directory
  config.persistDataDir = testDataDir;
  
  // Clear test directory
  if (fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }
  
  // Set test domains
  config.domains = ['https://domain1.com', 'https://domain2.com'];
  
  // Create test data for each domain
  saveDomainHistory('https://domain1.com', [
    { timestamp: new Date().toISOString(), status: 'healthy' }
  ]);
  saveDomainHistory('https://domain2.com', [
    { timestamp: new Date().toISOString(), status: 'unhealthy' },
    { timestamp: new Date().toISOString(), status: 'healthy' }
  ]);
  
  // Clear in-memory data
  healthHistory.clear();
  
  // Load all persisted data
  loadAllPersistedData();
  
  // Verify data was loaded
  assert(healthHistory.has('https://domain1.com'), 'Should load domain1 history');
  assert(healthHistory.has('https://domain2.com'), 'Should load domain2 history');
  assert.strictEqual(healthHistory.get('https://domain1.com').length, 1, 'Domain1 should have 1 entry');
  assert.strictEqual(healthHistory.get('https://domain2.com').length, 2, 'Domain2 should have 2 entries');
  
  console.log('✅ Load all persisted data test passed');
}

async function runPersistenceTests() {
  try {
    console.log('Starting persistence tests...\n');
    
    await testPersistenceBasic();
    await testPersistenceRetention();
    await testPersistenceErrorHandling();
    await testLoadAllPersistedData();
    
    console.log('\n🎉 All persistence tests passed successfully!');
    
    // Clean up test directory
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
    
    // Restore original config
    config.persistDataDir = originalPersistDataDir;
    
    return true;
  } catch (error) {
    console.error('\n❌ Persistence tests failed:', error.message);
    
    // Clean up test directory
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
    
    // Restore original config
    config.persistDataDir = originalPersistDataDir;
    
    return false;
  }
}

// Export for use in other tests
module.exports = {
  runPersistenceTests,
  testPersistenceBasic,
  testPersistenceRetention,
  testPersistenceErrorHandling,
  testLoadAllPersistedData
};

// Run if executed directly
if (require.main === module) {
  runPersistenceTests();
}