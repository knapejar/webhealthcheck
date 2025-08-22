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

async function testPersistencePermissions() {
  console.log('Testing persistence with permission scenarios...');
  
  const restrictedTestDir = '/tmp/test-restricted-data';
  
  // Create a directory and restrict permissions to simulate Docker permission issues
  if (fs.existsSync(restrictedTestDir)) {
    fs.rmSync(restrictedTestDir, { recursive: true, force: true });
  }
  
  // Create directory with restrictive permissions (owned by root-like scenario)
  fs.mkdirSync(restrictedTestDir, { recursive: true });
  
  try {
    // Try to make it read-only to simulate permission issues
    fs.chmodSync(restrictedTestDir, 0o555); // read and execute only
    
    // Set test data directory to the restricted one
    config.persistDataDir = restrictedTestDir;
    
    const testDomain = 'https://permtest.com';
    
    // Clear in-memory history
    healthHistory.clear();
    healthHistory.set(testDomain, []);
    
    // Try to add history - this should handle the permission error gracefully
    addToHistory(testDomain, 'healthy');
    
    // The persistence should fail gracefully, but in-memory should work
    assert(healthHistory.has(testDomain), 'Should still have in-memory history');
    assert.strictEqual(healthHistory.get(testDomain).length, 1, 'Should have 1 entry in memory');
    
    console.log('✅ Permission restrictions handled gracefully');
    
    // Now test fixing permissions
    fs.chmodSync(restrictedTestDir, 0o755); // make writable
    
    // Try persistence again - should work now
    addToHistory(testDomain, 'unhealthy');
    
    // Verify file was created
    const fileName = testDomain.replace(/[^a-zA-Z0-9.-]/g, '_') + '.json';
    const filePath = path.join(restrictedTestDir, fileName);
    assert(fs.existsSync(filePath), 'Persistence file should exist after fixing permissions');
    
    console.log('✅ Persistence works after fixing permissions');
    
  } finally {
    // Clean up
    if (fs.existsSync(restrictedTestDir)) {
      try {
        fs.chmodSync(restrictedTestDir, 0o755); // make sure we can delete it
        fs.rmSync(restrictedTestDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.warn('Could not clean up restricted test directory:', cleanupError.message);
      }
    }
  }
  
  console.log('✅ Persistence permissions test passed');
}

async function testDirectoryAutoCreation() {
  console.log('Testing automatic directory creation...');
  
  const newTestDir = '/tmp/test-auto-create/sub/deep';
  
  // Make sure directory doesn't exist
  if (fs.existsSync('/tmp/test-auto-create')) {
    fs.rmSync('/tmp/test-auto-create', { recursive: true, force: true });
  }
  
  // Set test data directory to non-existent path
  config.persistDataDir = newTestDir;
  
  const testDomain = 'https://autocreate.com';
  
  // Clear in-memory history
  healthHistory.clear();
  healthHistory.set(testDomain, []);
  
  // Add history - this should create the directory automatically
  addToHistory(testDomain, 'healthy');
  
  // Verify directory was created
  assert(fs.existsSync(newTestDir), 'Directory should be auto-created');
  
  // Verify file was created
  const fileName = testDomain.replace(/[^a-zA-Z0-9.-]/g, '_') + '.json';
  const filePath = path.join(newTestDir, fileName);
  assert(fs.existsSync(filePath), 'Persistence file should exist in auto-created directory');
  
  // Clean up
  fs.rmSync('/tmp/test-auto-create', { recursive: true, force: true });
  
  console.log('✅ Directory auto-creation test passed');
}

async function testDockerPermissionScenario() {
  console.log('Testing Docker-like permission scenario...');
  
  const dockerTestDir = '/tmp/test-docker-data';
  
  // Clean up first
  if (fs.existsSync(dockerTestDir)) {
    fs.rmSync(dockerTestDir, { recursive: true, force: true });
  }
  
  // Simulate a Docker scenario where the directory is created by root but the app runs as a different user
  // Create directory with root-like ownership (we'll simulate with restrictive permissions)
  fs.mkdirSync(dockerTestDir, { recursive: true });
  fs.chmodSync(dockerTestDir, 0o555); // read and execute only, no write
  
  config.persistDataDir = dockerTestDir;
  
  const testDomain = 'https://www.helgilibrary.com/';
  
  // Clear in-memory history
  healthHistory.clear();
  healthHistory.set(testDomain, []);
  
  // This should trigger the permission error similar to the one in the issue
  console.log('Attempting to save to restricted directory (simulating Docker permission issue)...');
  addToHistory(testDomain, 'healthy');
  
  // The app should continue working with in-memory data
  assert(healthHistory.has(testDomain), 'Should still have in-memory history');
  assert.strictEqual(healthHistory.get(testDomain).length, 1, 'Should have 1 entry in memory despite persistence failure');
  
  // Clean up
  try {
    fs.chmodSync(dockerTestDir, 0o755);
    fs.rmSync(dockerTestDir, { recursive: true, force: true });
  } catch (cleanupError) {
    console.warn('Could not clean up Docker test directory:', cleanupError.message);
  }
  
  console.log('✅ Docker permission scenario handled gracefully');
}

async function runPersistenceTests() {
  try {
    console.log('Starting persistence tests...\n');
    
    await testPersistenceBasic();
    await testPersistenceRetention();
    await testPersistenceErrorHandling();
    await testLoadAllPersistedData();
    await testPersistencePermissions();
    await testDirectoryAutoCreation();
    await testDockerPermissionScenario();
    
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
  testLoadAllPersistedData,
  testPersistencePermissions,
  testDirectoryAutoCreation,
  testDockerPermissionScenario
};

// Run if executed directly
if (require.main === module) {
  runPersistenceTests();
}