const { healthHistory, generateHistoryPage } = require('../index.js');

// Debug the timing calculation logic to understand the issue better
function debugTimingCalculation() {
  console.log('Debugging timing calculation logic...\n');
  
  const domain = 'debug-domain.com';
  healthHistory.clear();
  
  // Simulate the exact calculation from generateHistoryPage
  const now = new Date();
  const minutesInDay = 24 * 60;
  console.log('Current time (now):', now.toISOString());
  console.log('Minutes in day:', minutesInDay);
  
  // Start time for 24-hour window
  const windowStart = new Date(now.getTime() - minutesInDay * 60 * 1000);
  console.log('24-hour window starts at:', windowStart.toISOString());
  
  // Create test entries with precise timing
  const testEntries = [];
  
  // Create entries at exact minute boundaries
  for (let i = 1; i <= 5; i++) {
    const minuteTime = new Date(now.getTime() - (i * 60 * 1000));
    minuteTime.setSeconds(0, 0); // Exact minute boundary
    testEntries.push({
      timestamp: minuteTime.toISOString(),
      status: 'healthy',
      description: `Entry ${i} - exact minute boundary`
    });
  }
  
  // Create entries with millisecond offsets
  for (let i = 1; i <= 3; i++) {
    const offsetTime = new Date(now.getTime() - (i * 60 * 1000) + 999); // +999ms
    testEntries.push({
      timestamp: offsetTime.toISOString(),
      status: 'unhealthy',
      description: `Entry ${i} - with +999ms offset`
    });
  }
  
  // Create entries just before window boundary
  const nearBoundaryTime = new Date(windowStart.getTime() + 500); // 500ms after window start
  testEntries.push({
    timestamp: nearBoundaryTime.toISOString(),
    status: 'healthy',
    description: 'Near window boundary (+500ms)'
  });
  
  healthHistory.set(domain, testEntries);
  
  console.log('\nTest entries created:');
  testEntries.forEach((entry, index) => {
    console.log(`${index + 1}. ${entry.timestamp} - ${entry.status} (${entry.description})`);
  });
  
  // Now simulate the calculation logic from generateHistoryPage
  console.log('\n=== Simulating mapping calculation ===');
  
  testEntries.forEach((entry, index) => {
    const entryTime = new Date(entry.timestamp);
    
    // This is the exact calculation from generateHistoryPage line 407
    const minutesFromStart = Math.floor((entryTime.getTime() - (now.getTime() - minutesInDay * 60 * 1000)) / (60 * 1000));
    
    // Alternative calculation for comparison
    const altCalc = Math.floor((entryTime.getTime() - windowStart.getTime()) / (60 * 1000));
    
    console.log(`Entry ${index + 1}:`);
    console.log(`  Entry time: ${entryTime.toISOString()}`);
    console.log(`  Entry timestamp: ${entryTime.getTime()}`);
    console.log(`  Window start timestamp: ${windowStart.getTime()}`);
    console.log(`  Time diff (ms): ${entryTime.getTime() - windowStart.getTime()}`);
    console.log(`  Original calc: ${minutesFromStart}`);
    console.log(`  Alt calc: ${altCalc}`);
    console.log(`  Valid range: ${minutesFromStart >= 0 && minutesFromStart < minutesInDay ? 'YES' : 'NO'}`);
    console.log(`  Would map to grid[${minutesFromStart}]`);
    console.log('');
  });
  
  // Test with different "now" values to see if timing affects results
  console.log('\n=== Testing timing sensitivity ===');
  
  const results = [];
  for (let offset = 0; offset < 5; offset++) {
    // Simulate different "now" times
    const simulatedNow = new Date(now.getTime() + offset * 100); // 100ms offsets
    const simulatedWindowStart = new Date(simulatedNow.getTime() - minutesInDay * 60 * 1000);
    
    let mappedEntries = 0;
    testEntries.forEach(entry => {
      const entryTime = new Date(entry.timestamp);
      const minutesFromStart = Math.floor((entryTime.getTime() - simulatedWindowStart.getTime()) / (60 * 1000));
      
      if (minutesFromStart >= 0 && minutesFromStart < minutesInDay) {
        mappedEntries++;
      }
    });
    
    results.push({
      offset: offset * 100,
      mappedEntries: mappedEntries,
      simulatedNow: simulatedNow.toISOString()
    });
    
    console.log(`Offset +${offset * 100}ms: ${mappedEntries}/${testEntries.length} entries mapped`);
  }
  
  // Check for inconsistency
  const firstResult = results[0];
  const hasInconsistency = results.some(r => r.mappedEntries !== firstResult.mappedEntries);
  
  if (hasInconsistency) {
    console.log('\n❌ TIMING INCONSISTENCY DETECTED!');
    console.log('Different "now" timestamps result in different mapping outcomes.');
  } else {
    console.log('\n✅ No timing inconsistency in this test.');
  }
  
  return hasInconsistency;
}

// Test with fractional seconds that could cause Math.floor issues
function testMathFloorPrecision() {
  console.log('\n\n=== Testing Math.floor precision issues ===');
  
  const now = new Date();
  const minutesInDay = 24 * 60;
  const windowStart = new Date(now.getTime() - minutesInDay * 60 * 1000);
  
  console.log('Testing millisecond precision near minute boundaries...\n');
  
  // Test cases where milliseconds might affect Math.floor results
  const testCases = [
    { offset: 0, desc: 'Exactly at minute boundary' },
    { offset: 1, desc: '+1ms from minute boundary' },
    { offset: 999, desc: '+999ms from minute boundary' },
    { offset: 1000, desc: 'Next minute exactly' },
    { offset: 59000, desc: 'Near end of minute' },
    { offset: 59999, desc: 'Almost next minute' }
  ];
  
  let hasFloorIssues = false;
  
  testCases.forEach(testCase => {
    const entryTime = new Date(now.getTime() - (5 * 60 * 1000) + testCase.offset);
    
    // Original calculation
    const minutesFromStart = Math.floor((entryTime.getTime() - windowStart.getTime()) / (60 * 1000));
    
    // More precise calculation using rounding instead of floor
    const preciseMinutes = Math.round((entryTime.getTime() - windowStart.getTime()) / (60 * 1000));
    
    console.log(`${testCase.desc}:`);
    console.log(`  Entry time: ${entryTime.toISOString()}`);
    console.log(`  Math.floor result: ${minutesFromStart}`);
    console.log(`  Math.round result: ${preciseMinutes}`);
    
    if (minutesFromStart !== preciseMinutes) {
      console.log(`  ⚠️  DIFFERENCE: floor=${minutesFromStart}, round=${preciseMinutes}`);
      hasFloorIssues = true;
    } else {
      console.log(`  ✅ Consistent results`);
    }
    console.log('');
  });
  
  if (hasFloorIssues) {
    console.log('❌ Math.floor precision issues detected!');
    console.log('Entries near minute boundaries may map to wrong grid positions.');
  } else {
    console.log('✅ No Math.floor precision issues in this test.');
  }
  
  return hasFloorIssues;
}

function runDebugTests() {
  console.log('Starting debug tests for non-deterministic rendering issue...\n');
  
  const hasTimingIssue = debugTimingCalculation();
  const hasFloorIssue = testMathFloorPrecision();
  
  console.log('\n=== SUMMARY ===');
  if (hasTimingIssue || hasFloorIssue) {
    console.log('🎯 Issues found that could cause non-deterministic rendering:');
    if (hasTimingIssue) console.log('  - Timing inconsistency in calculations');
    if (hasFloorIssue) console.log('  - Math.floor precision issues');
  } else {
    console.log('ℹ️  No obvious issues found in this run, but the problem may be more subtle.');
  }
}

if (require.main === module) {
  runDebugTests();
}

module.exports = {
  debugTimingCalculation,
  testMathFloorPrecision,
  runDebugTests
};