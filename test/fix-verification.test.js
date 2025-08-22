const { healthHistory, generateHistoryPage } = require('../index.js');

// Test to verify that the Math.round fix resolves the non-deterministic rendering issue
async function testFixedRendering() {
  console.log('Testing fixed rendering with Math.round...');
  
  const domain = 'test-fixed-domain.com';
  healthHistory.clear();
  
  // Create test data that previously caused issues with Math.floor
  const testHistory = [];
  const now = new Date();
  
  // Create entries that are near minute boundaries (59 seconds)
  // These were causing Math.floor to map to wrong positions
  for (let i = 1; i <= 10; i++) {
    // Create entry at 59 seconds of each minute (near end of minute)
    const nearEndOfMinute = new Date(now.getTime() - (i * 60 * 1000) + 59000);
    testHistory.push({
      timestamp: nearEndOfMinute.toISOString(),
      status: i % 2 === 0 ? 'healthy' : 'unhealthy'
    });
    
    // Create entry at 1 second of each minute (near start of minute)
    const nearStartOfMinute = new Date(now.getTime() - (i * 60 * 1000) + 1000);
    testHistory.push({
      timestamp: nearStartOfMinute.toISOString(),
      status: i % 2 === 0 ? 'unhealthy' : 'healthy'
    });
  }
  
  healthHistory.set(domain, testHistory);
  
  // Generate the page multiple times to test for consistency
  console.log('Testing consistency with Math.round fix...');
  const results = [];
  
  for (let i = 0; i < 5; i++) {
    // Small delay to simulate different timing conditions
    await new Promise(resolve => setTimeout(resolve, 10));
    
    const html = generateHistoryPage(domain, healthHistory.get(domain));
    
    const unknownCount = (html.match(/minute-square unknown/g) || []).length;
    const healthyCount = (html.match(/minute-square healthy/g) || []).length;
    const unhealthyCount = (html.match(/minute-square unhealthy/g) || []).length;
    
    results.push({
      iteration: i + 1,
      unknown: unknownCount,
      healthy: healthyCount,
      unhealthy: unhealthyCount
    });
    
    console.log(`Iteration ${i + 1}: Unknown=${unknownCount}, Healthy=${healthyCount}, Unhealthy=${unhealthyCount}`);
  }
  
  // Check for consistency
  const firstResult = results[0];
  let isConsistent = true;
  
  for (let i = 1; i < results.length; i++) {
    if (results[i].unknown !== firstResult.unknown ||
        results[i].healthy !== firstResult.healthy ||
        results[i].unhealthy !== firstResult.unhealthy) {
      isConsistent = false;
      console.log(`❌ Inconsistency between iteration 1 and ${i + 1}`);
      break;
    }
  }
  
  if (isConsistent) {
    console.log('✅ All iterations produced consistent results');
  }
  
  // Check that we have fewer unknown squares than test data entries
  // With 20 entries, we should have significantly fewer than 1440 unknown squares
  const avgUnknown = results.reduce((sum, r) => sum + r.unknown, 0) / results.length;
  const expectedMapped = testHistory.length;
  const actualMapped = 1440 - avgUnknown;
  
  console.log(`Expected ~${expectedMapped} mapped entries, got ${actualMapped}`);
  
  const mappingEfficiency = actualMapped / expectedMapped;
  console.log(`Mapping efficiency: ${(mappingEfficiency * 100).toFixed(1)}%`);
  
  return {
    isConsistent,
    mappingEfficiency,
    avgUnknown,
    testPassed: isConsistent && mappingEfficiency > 0.8 // At least 80% mapping efficiency
  };
}

// Test specific edge cases that were problematic before the fix
async function testEdgeCaseFix() {
  console.log('\nTesting edge case fix...');
  
  const domain = 'edge-case-domain.com';
  healthHistory.clear();
  
  const now = new Date();
  const testEntries = [];
  
  // Create entries at problematic timestamps
  const edgeCases = [
    { offset: 59000, desc: '59 seconds into minute (was problematic)' },
    { offset: 59900, desc: '59.9 seconds into minute (was very problematic)' },
    { offset: 59999, desc: '59.999 seconds into minute (worst case)' },
    { offset: 0, desc: 'Exactly at minute boundary' },
    { offset: 500, desc: '0.5 seconds into minute' },
    { offset: 30000, desc: '30 seconds into minute' }
  ];
  
  edgeCases.forEach((testCase, index) => {
    const timestamp = new Date(now.getTime() - (60 * 1000) + testCase.offset); // All in last minute
    testEntries.push({
      timestamp: timestamp.toISOString(),
      status: index % 2 === 0 ? 'healthy' : 'unhealthy',
      description: testCase.desc
    });
  });
  
  healthHistory.set(domain, testEntries);
  
  // Generate page and analyze results
  const html = generateHistoryPage(domain, healthHistory.get(domain));
  const unknownCount = (html.match(/minute-square unknown/g) || []).length;
  const totalMapped = (html.match(/minute-square (healthy|unhealthy)/g) || []).length;
  
  console.log(`Edge case test results:`);
  console.log(`  Test entries: ${testEntries.length}`);
  console.log(`  Mapped entries: ${totalMapped}`);
  console.log(`  Unknown squares: ${unknownCount}`);
  console.log(`  Mapping success: ${totalMapped}/${testEntries.length} entries`);
  
  const allMapped = totalMapped === testEntries.length;
  
  if (allMapped) {
    console.log('✅ All edge case entries mapped correctly');
  } else {
    console.log('❌ Some edge case entries not mapped correctly');
  }
  
  return {
    allMapped,
    totalMapped,
    testEntries: testEntries.length
  };
}

// Compare before and after behavior (simulate the old bug)
async function compareBeforeAndAfter() {
  console.log('\nComparing Math.floor vs Math.round behavior...');
  
  const domain = 'compare-domain.com';
  healthHistory.clear();
  
  // Create test data that demonstrates the difference
  const testHistory = [];
  const now = new Date();
  
  // Entries near minute boundaries that show the Math.floor vs Math.round difference
  for (let i = 1; i <= 5; i++) {
    const nearEnd = new Date(now.getTime() - (i * 60 * 1000) + 59500); // 59.5 seconds
    testHistory.push({
      timestamp: nearEnd.toISOString(),
      status: 'healthy'
    });
  }
  
  healthHistory.set(domain, testHistory);
  
  // Simulate old behavior with Math.floor
  const minutesInDay = 24 * 60;
  const windowStart = new Date(now.getTime() - minutesInDay * 60 * 1000);
  
  let floorMappedCount = 0;
  let roundMappedCount = 0;
  
  testHistory.forEach(entry => {
    const entryTime = new Date(entry.timestamp);
    
    // Old behavior (Math.floor)
    const floorMinutes = Math.floor((entryTime.getTime() - windowStart.getTime()) / (60 * 1000));
    if (floorMinutes >= 0 && floorMinutes < minutesInDay) {
      floorMappedCount++;
    }
    
    // New behavior (Math.round)
    const roundMinutes = Math.round((entryTime.getTime() - windowStart.getTime()) / (60 * 1000));
    if (roundMinutes >= 0 && roundMinutes < minutesInDay) {
      roundMappedCount++;
    }
    
    console.log(`Entry: ${entryTime.toISOString()}`);
    console.log(`  Math.floor: ${floorMinutes} (valid: ${floorMinutes >= 0 && floorMinutes < minutesInDay})`);
    console.log(`  Math.round: ${roundMinutes} (valid: ${roundMinutes >= 0 && roundMinutes < minutesInDay})`);
  });
  
  console.log(`\nComparison results:`);
  console.log(`  Math.floor mapped: ${floorMappedCount}/${testHistory.length} entries`);
  console.log(`  Math.round mapped: ${roundMappedCount}/${testHistory.length} entries`);
  
  const improvement = roundMappedCount > floorMappedCount;
  if (improvement) {
    console.log('✅ Math.round maps more entries correctly');
  } else {
    console.log('ℹ️  No difference in this test case');
  }
  
  return {
    floorMappedCount,
    roundMappedCount,
    improvement
  };
}

async function runFixVerificationTests() {
  console.log('Starting fix verification tests...\n');
  
  const results = {};
  
  results.fixedRendering = await testFixedRendering();
  results.edgeCaseFix = await testEdgeCaseFix();
  results.comparison = await compareBeforeAndAfter();
  
  console.log('\n=== FIX VERIFICATION SUMMARY ===');
  
  if (results.fixedRendering.testPassed) {
    console.log('✅ Fixed rendering test: PASSED');
  } else {
    console.log('❌ Fixed rendering test: FAILED');
  }
  
  if (results.edgeCaseFix.allMapped) {
    console.log('✅ Edge case fix test: PASSED');
  } else {
    console.log('❌ Edge case fix test: FAILED');
  }
  
  if (results.comparison.improvement) {
    console.log('✅ Math.round improvement: CONFIRMED');
  } else {
    console.log('ℹ️  Math.round improvement: NOT DEMONSTRATED IN THIS TEST');
  }
  
  const overallSuccess = results.fixedRendering.testPassed && results.edgeCaseFix.allMapped;
  
  if (overallSuccess) {
    console.log('\n🎉 ALL TESTS PASSED - Fix appears to work correctly!');
  } else {
    console.log('\n⚠️  Some tests failed - fix may need refinement');
  }
  
  return overallSuccess;
}

if (require.main === module) {
  runFixVerificationTests();
}

module.exports = {
  runFixVerificationTests,
  testFixedRendering,
  testEdgeCaseFix,
  compareBeforeAndAfter
};