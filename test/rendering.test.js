const assert = require('assert');
const { healthHistory, generateHistoryPage } = require('../index.js');

// Test to replicate the non-deterministic rendering issue
async function testNonDeterministicRendering() {
  console.log('Testing non-deterministic rendering issue...');
  
  const domain = 'test-domain.com';
  
  // Clear any existing history
  healthHistory.clear();
  
  // Create test history data with precise timestamps that could trigger the bug
  const testHistory = [];
  const baseTime = new Date();
  
  // Create entries that are exactly at minute boundaries
  // This is where the Math.floor calculation can cause issues
  for (let i = 0; i < 10; i++) {
    // Create entries exactly at minute boundaries (0 seconds, 0 milliseconds)
    const exactMinuteBoundary = new Date(baseTime.getTime() - (i * 60 * 1000));
    exactMinuteBoundary.setSeconds(0, 0); // Set to exactly 0 seconds, 0 ms
    
    testHistory.push({
      timestamp: exactMinuteBoundary.toISOString(),
      status: 'healthy'
    });
  }
  
  // Add some entries with slight timing offsets that could cause mapping issues
  for (let i = 0; i < 5; i++) {
    // Create entries with small millisecond offsets near minute boundaries
    const offsetTime = new Date(baseTime.getTime() - (i * 60 * 1000) + 999); // 999ms offset
    testHistory.push({
      timestamp: offsetTime.toISOString(),
      status: 'unhealthy'
    });
  }
  
  healthHistory.set(domain, testHistory);
  
  // Generate the history page multiple times to test for non-deterministic behavior
  const renderings = [];
  for (let i = 0; i < 5; i++) {
    // Small delay to simulate different timing conditions
    await new Promise(resolve => setTimeout(resolve, 10));
    
    const html = generateHistoryPage(domain, healthHistory.get(domain));
    
    // Extract the minute squares from the HTML
    const unknownMatches = (html.match(/minute-square unknown/g) || []).length;
    const healthyMatches = (html.match(/minute-square healthy/g) || []).length;
    const unhealthyMatches = (html.match(/minute-square unhealthy/g) || []).length;
    
    renderings.push({
      iteration: i + 1,
      unknown: unknownMatches,
      healthy: healthyMatches,
      unhealthy: unhealthyMatches,
      total: unknownMatches + healthyMatches + unhealthyMatches
    });
    
    console.log(`Rendering ${i + 1}: Unknown=${unknownMatches}, Healthy=${healthyMatches}, Unhealthy=${unhealthyMatches}`);
  }
  
  // Check for inconsistencies between renderings
  const firstRendering = renderings[0];
  let hasInconsistency = false;
  
  for (let i = 1; i < renderings.length; i++) {
    if (renderings[i].unknown !== firstRendering.unknown ||
        renderings[i].healthy !== firstRendering.healthy ||
        renderings[i].unhealthy !== firstRendering.unhealthy) {
      hasInconsistency = true;
      console.log(`❌ Inconsistency detected between rendering 1 and ${i + 1}`);
    }
  }
  
  // Also check if we have unexpected unknown squares
  // Given our test data, we should have very few unknown squares
  // If we have many, it indicates the mapping bug
  const avgUnknownSquares = renderings.reduce((sum, r) => sum + r.unknown, 0) / renderings.length;
  console.log(`Average unknown squares: ${avgUnknownSquares}`);
  
  // We expect to have close to 1440 total squares (24 hours * 60 minutes)
  // But only 15 entries of test data, so most should be unknown
  // The issue is when entries that should map to specific squares don't
  
  if (hasInconsistency) {
    console.log('❌ Non-deterministic rendering issue reproduced!');
    return true; // Issue reproduced
  } else {
    console.log('✅ Rendering appears consistent (issue not reproduced in this run)');
    return false; // Issue not reproduced
  }
}

// Test with edge case timestamps to trigger the bug more reliably
async function testEdgeCaseTimestamps() {
  console.log('Testing edge case timestamps...');
  
  const domain = 'edge-test-domain.com';
  healthHistory.clear();
  
  const testHistory = [];
  const now = new Date();
  
  // Create entries that are likely to trigger the Math.floor precision issue
  // These are at millisecond boundaries that could round incorrectly
  for (let minutes = 1; minutes <= 60; minutes++) {
    for (let msOffset of [0, 1, 999, 500]) {
      const timestamp = new Date(now.getTime() - (minutes * 60 * 1000) + msOffset);
      testHistory.push({
        timestamp: timestamp.toISOString(),
        status: minutes % 2 === 0 ? 'healthy' : 'unhealthy'
      });
    }
  }
  
  healthHistory.set(domain, testHistory);
  
  // Generate the page and check for mapping issues
  const html = generateHistoryPage(domain, healthHistory.get(domain));
  
  const unknownCount = (html.match(/minute-square unknown/g) || []).length;
  const totalSquares = (html.match(/minute-square/g) || []).length;
  
  console.log(`Edge case test: ${unknownCount} unknown out of ${totalSquares} total squares`);
  console.log(`Test data entries: ${testHistory.length}`);
  
  // With 240 test entries over 60 minutes, we should have much fewer unknown squares
  // If we have close to 1440 unknown squares, it means most entries failed to map
  const expectedMappedEntries = Math.min(testHistory.length, 60); // At most 60 minutes of data
  const actualMappedEntries = (totalSquares - unknownCount);
  
  console.log(`Expected roughly ${expectedMappedEntries} mapped entries, got ${actualMappedEntries}`);
  
  if (actualMappedEntries < expectedMappedEntries * 0.5) { // If less than 50% mapped correctly
    console.log('❌ Edge case test reveals mapping issues!');
    return true;
  } else {
    console.log('✅ Edge case test passed');
    return false;
  }
}

async function runRenderingTests() {
  console.log('Starting rendering issue tests...\n');
  
  let issueReproduced = false;
  
  // Try multiple times since the issue is non-deterministic
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`\n=== Attempt ${attempt} ===`);
    
    const reproduced1 = await testNonDeterministicRendering();
    const reproduced2 = await testEdgeCaseTimestamps();
    
    if (reproduced1 || reproduced2) {
      issueReproduced = true;
      break;
    }
  }
  
  if (issueReproduced) {
    console.log('\n🎯 Successfully reproduced the non-deterministic rendering issue!');
  } else {
    console.log('\n⚠️  Issue not reproduced in test runs (may require more specific conditions)');
  }
  
  return issueReproduced;
}

// Export for use in other tests
module.exports = {
  runRenderingTests,
  testNonDeterministicRendering,
  testEdgeCaseTimestamps
};

// Run tests if this file is executed directly
if (require.main === module) {
  runRenderingTests();
}