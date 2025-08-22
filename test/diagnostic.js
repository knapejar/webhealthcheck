const { healthHistory, generateHistoryPage } = require('../index.js');

// Detailed diagnostic to understand mapping failures
function diagnosticTest() {
  console.log('Running detailed diagnostic on mapping logic...\n');
  
  const domain = 'diagnostic-test.com';
  healthHistory.clear();
  
  const now = new Date();
  const minutesInDay = 24 * 60;
  
  console.log(`Current time: ${now.toISOString()}`);
  console.log(`Minutes in day: ${minutesInDay}`);
  
  // Test with a few strategic entries
  const testEntries = [
    { minutesAgo: 1, seconds: 0, desc: '1 minute ago, 0 seconds' },
    { minutesAgo: 1, seconds: 30, desc: '1 minute ago, 30 seconds' },
    { minutesAgo: 1, seconds: 59, desc: '1 minute ago, 59 seconds' },
    { minutesAgo: 60, seconds: 0, desc: '60 minutes ago, 0 seconds' },
    { minutesAgo: 60, seconds: 59, desc: '60 minutes ago, 59 seconds' },
    { minutesAgo: 1440 - 1, seconds: 0, desc: 'Near 24h boundary, 0 seconds' },
    { minutesAgo: 1440 - 1, seconds: 59, desc: 'Near 24h boundary, 59 seconds' }
  ];
  
  const testHistory = [];
  
  testEntries.forEach((entry, index) => {
    const timestamp = new Date(
      now.getTime() - 
      (entry.minutesAgo * 60 * 1000) + 
      (entry.seconds * 1000)
    );
    
    testHistory.push({
      timestamp: timestamp.toISOString(),
      status: index % 2 === 0 ? 'healthy' : 'unhealthy',
      description: entry.desc
    });
    
    console.log(`Entry ${index + 1}: ${timestamp.toISOString()} - ${entry.desc}`);
  });
  
  healthHistory.set(domain, testHistory);
  
  console.log('\n=== Manual Calculation Check ===');
  
  // Simulate the exact logic from generateHistoryPage
  testHistory.forEach((entry, index) => {
    const entryTime = new Date(entry.timestamp);
    
    // This is the exact calculation from the fixed code
    const rawMinutes = (entryTime.getTime() - (now.getTime() - minutesInDay * 60 * 1000)) / (60 * 1000);
    const minutesFromStart = Math.max(0, Math.min(minutesInDay - 1, Math.round(rawMinutes)));
    
    const isInValidRange = minutesFromStart >= 0 && minutesFromStart < minutesInDay;
    
    console.log(`Entry ${index + 1}: ${entry.description}`);
    console.log(`  Timestamp: ${entryTime.getTime()}`);
    console.log(`  Raw minutes: ${rawMinutes.toFixed(3)}`);
    console.log(`  Clamped minutes: ${minutesFromStart}`);
    console.log(`  Valid range: ${isInValidRange ? 'YES' : 'NO'}`);
    console.log('');
  });
  
  console.log('=== Generate History Page Test ===');
  
  // Generate the actual page
  const html = generateHistoryPage(domain, healthHistory.get(domain));
  
  const unknownCount = (html.match(/minute-square unknown/g) || []).length;
  const mappedCount = (html.match(/minute-square (healthy|unhealthy)/g) || []).length;
  
  console.log(`Results:`);
  console.log(`  Test entries: ${testHistory.length}`);
  console.log(`  Mapped entries: ${mappedCount}`);
  console.log(`  Success rate: ${(mappedCount / testHistory.length * 100).toFixed(1)}%`);
  
  // Check for any entries in the last few squares to see if boundary logic is working
  const lastSquareMatches = html.match(new RegExp(`minute-square (healthy|unhealthy)"[^>]*title="[^"]*- (healthy|unhealthy)"`, 'g')) || [];
  console.log(`  Found status squares: ${lastSquareMatches.length}`);
  
  if (mappedCount < testHistory.length) {
    console.log('\n❌ Some entries failed to map. This might indicate:');
    console.log('  1. Entries falling outside the 24-hour window');
    console.log('  2. Precision issues in the calculation');
    console.log('  3. Boundary condition problems');
  } else {
    console.log('\n✅ All entries mapped successfully');
  }
  
  return mappedCount === testHistory.length;
}

if (require.main === module) {
  diagnosticTest();
}

module.exports = { diagnosticTest };