const { healthHistory, generateHistoryPage } = require('../index.js');

// Simple test to verify the fix with a realistic scenario
async function testRealisticScenario() {
  console.log('Testing realistic scenario with actual history data...');
  
  const domain = 'realistic-test.com';
  healthHistory.clear();
  
  // Create realistic test data similar to what the app would generate
  const testHistory = [];
  const now = new Date();
  
  // Simulate 1 hour of health checks (every minute) with various timing
  for (let minutesAgo = 1; minutesAgo <= 60; minutesAgo++) {
    // Vary the exact timing within each minute to simulate real conditions
    const randomSeconds = Math.floor(Math.random() * 60); // 0-59 seconds
    const randomMs = Math.floor(Math.random() * 1000); // 0-999 ms
    
    const timestamp = new Date(
      now.getTime() - (minutesAgo * 60 * 1000) + (randomSeconds * 1000) + randomMs
    );
    
    testHistory.push({
      timestamp: timestamp.toISOString(),
      status: Math.random() > 0.1 ? 'healthy' : 'unhealthy' // 90% healthy, 10% unhealthy
    });
  }
  
  console.log(`Created ${testHistory.length} test entries over the last hour`);
  
  healthHistory.set(domain, testHistory);
  
  // Generate the history page
  const html = generateHistoryPage(domain, healthHistory.get(domain));
  
  // Count the results
  const unknownCount = (html.match(/minute-square unknown/g) || []).length;
  const healthyCount = (html.match(/minute-square healthy/g) || []).length;
  const unhealthyCount = (html.match(/minute-square unhealthy/g) || []).length;
  const totalSquares = unknownCount + healthyCount + unhealthyCount;
  
  console.log(`Results:`);
  console.log(`  Total squares: ${totalSquares}`);
  console.log(`  Unknown: ${unknownCount}`);
  console.log(`  Healthy: ${healthyCount}`);
  console.log(`  Unhealthy: ${unhealthyCount}`);
  console.log(`  Entries that mapped: ${healthyCount + unhealthyCount}/${testHistory.length}`);
  
  const mappingSuccess = healthyCount + unhealthyCount;
  const expectedMapping = testHistory.length;
  const successRate = (mappingSuccess / expectedMapping) * 100;
  
  console.log(`  Mapping success rate: ${successRate.toFixed(1)}%`);
  
  // Success criteria: at least 80% of entries should map correctly
  const testPassed = successRate >= 80;
  
  if (testPassed) {
    console.log('✅ Realistic scenario test PASSED');
  } else {
    console.log('❌ Realistic scenario test FAILED');
  }
  
  return {
    testPassed,
    successRate,
    mappingSuccess,
    expectedMapping
  };
}

// Test that specifically targets the edge case that caused the original issue
async function testSpecificEdgeCase() {
  console.log('\nTesting specific edge case that caused the original issue...');
  
  const domain = 'edge-case-test.com';
  healthHistory.clear();
  
  // Create entries that would have caused the Math.floor precision issue
  const now = new Date();
  const testEntries = [];
  
  // Create entries at exactly 59.5 seconds into various minutes
  // These are the ones that would be affected by Math.floor vs Math.round
  for (let i = 1; i <= 10; i++) {
    const timestamp = new Date(now.getTime() - (i * 60 * 1000) + 59500); // 59.5 seconds
    testEntries.push({
      timestamp: timestamp.toISOString(),
      status: i % 2 === 0 ? 'healthy' : 'unhealthy'
    });
  }
  
  healthHistory.set(domain, testEntries);
  
  // Generate the page
  const html = generateHistoryPage(domain, healthHistory.get(domain));
  
  const unknownCount = (html.match(/minute-square unknown/g) || []).length;
  const mappedCount = (html.match(/minute-square (healthy|unhealthy)/g) || []).length;
  
  console.log(`Edge case results:`);
  console.log(`  Test entries: ${testEntries.length}`);
  console.log(`  Mapped successfully: ${mappedCount}`);
  console.log(`  Failed to map: ${testEntries.length - mappedCount}`);
  
  // All entries should map successfully with the fix
  const allMapped = mappedCount === testEntries.length;
  
  if (allMapped) {
    console.log('✅ Edge case test PASSED - all entries mapped correctly');
  } else {
    console.log(`❌ Edge case test FAILED - only ${mappedCount}/${testEntries.length} mapped`);
  }
  
  return {
    allMapped,
    mappedCount,
    totalEntries: testEntries.length
  };
}

async function runSimpleTests() {
  console.log('Running simple direct tests for the fix...\n');
  
  const results = await testRealisticScenario();
  const edgeResults = await testSpecificEdgeCase();
  
  console.log('\n=== SIMPLE TEST SUMMARY ===');
  
  if (results.testPassed && edgeResults.allMapped) {
    console.log('🎉 ALL SIMPLE TESTS PASSED!');
    console.log('The fix appears to resolve the non-deterministic rendering issue.');
  } else {
    console.log('⚠️  Some tests failed:');
    if (!results.testPassed) {
      console.log(`  - Realistic scenario: only ${results.successRate.toFixed(1)}% success rate`);
    }
    if (!edgeResults.allMapped) {
      console.log(`  - Edge case: only ${edgeResults.mappedCount}/${edgeResults.totalEntries} entries mapped`);
    }
  }
  
  return results.testPassed && edgeResults.allMapped;
}

if (require.main === module) {
  runSimpleTests();
}

module.exports = {
  runSimpleTests,
  testRealisticScenario,
  testSpecificEdgeCase
};