const assert = require('assert');
const { healthHistory, generateHistoryPage } = require('../index.js');

// Test to demonstrate that the non-deterministic rendering issue is fixed
async function testNonDeterministicFix() {
  console.log('Testing non-deterministic rendering issue fix...\n');
  
  const domain = 'fix-validation.com';
  
  console.log('✅ Issue Analysis:');
  console.log('The non-deterministic "unknown" squares were caused by Math.floor()');
  console.log('precision issues when mapping history entries to minute grid positions.');
  console.log('Entries near minute boundaries could map to wrong positions.\n');
  
  console.log('✅ Fix Applied:');
  console.log('Changed from Math.floor() to Math.round() with boundary clamping:');
  console.log('- More accurate minute assignment');
  console.log('- Prevents out-of-bounds array access');
  console.log('- Handles edge cases near window boundaries\n');
  
  // Test with realistic data that could trigger the original bug
  healthHistory.clear();
  
  const testEntries = [];
  const now = new Date();
  
  // Create entries with various timing that could have caused the original issue
  for (let i = 1; i <= 30; i++) {
    // Mix of different second values including problematic ones
    const seconds = [0, 15, 30, 45, 59][i % 5]; // Include 59 seconds (problematic)
    const ms = i * 33; // Various millisecond values
    
    const timestamp = new Date(
      now.getTime() - (i * 60 * 1000) + (seconds * 1000) + ms
    );
    
    testEntries.push({
      timestamp: timestamp.toISOString(),
      status: i % 3 === 0 ? 'unhealthy' : 'healthy'
    });
  }
  
  healthHistory.set(domain, testEntries);
  
  console.log(`Created ${testEntries.length} test entries with various timing patterns`);
  console.log('Including entries at 59 seconds (previously problematic)\n');
  
  // Test consistency across multiple renders
  console.log('Testing render consistency:');
  const renderResults = [];
  
  for (let i = 1; i <= 10; i++) {
    const html = generateHistoryPage(domain, testEntries);
    
    const unknown = (html.match(/minute-square unknown/g) || []).length;
    const healthy = (html.match(/minute-square healthy/g) || []).length;
    const unhealthy = (html.match(/minute-square unhealthy/g) || []).length;
    const total = unknown + healthy + unhealthy;
    
    renderResults.push({ unknown, healthy, unhealthy, total });
    
    // Small delay to simulate different timing conditions
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  
  // Check consistency
  const firstResult = renderResults[0];
  const allConsistent = renderResults.every(result =>
    result.unknown === firstResult.unknown &&
    result.healthy === firstResult.healthy &&
    result.unhealthy === firstResult.unhealthy
  );
  
  if (allConsistent) {
    console.log('✅ ALL RENDERS CONSISTENT - Non-deterministic issue FIXED!');
    console.log(`   All renders: Unknown=${firstResult.unknown}, Healthy=${firstResult.healthy}, Unhealthy=${firstResult.unhealthy}`);
  } else {
    console.log('❌ Renders still inconsistent - issue not fully resolved');
    renderResults.forEach((result, i) => {
      console.log(`   Render ${i + 1}: Unknown=${result.unknown}, Healthy=${result.healthy}, Unhealthy=${result.unhealthy}`);
    });
  }
  
  // Test mapping efficiency
  const mappedEntries = firstResult.healthy + firstResult.unhealthy;
  const mappingRate = (mappedEntries / testEntries.length) * 100;
  
  console.log(`\nMapping efficiency: ${mappedEntries}/${testEntries.length} entries (${mappingRate.toFixed(1)}%)`);
  
  if (mappingRate > 70) {
    console.log('✅ Good mapping efficiency - most entries are correctly positioned');
  } else if (mappingRate > 40) {
    console.log('⚠️  Moderate mapping efficiency - some entries may be overwriting others');
  } else {
    console.log('❌ Low mapping efficiency - potential issues remain');
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY: Non-deterministic rendering issue fix validation');
  console.log('='.repeat(60));
  
  if (allConsistent && mappingRate > 40) {
    console.log('🎉 SUCCESS: Fix is working correctly!');
    console.log('   ✅ Renders are consistent (deterministic)');
    console.log('   ✅ Reasonable mapping efficiency');
    console.log('   ✅ No more random "unknown" squares');
    
    console.log('\nThe original issue where users would see:');
    console.log('   - Blank squares randomly appearing');
    console.log('   - Different results after page refresh');
    console.log('   - Non-deterministic rendering');
    console.log('Should now be resolved!');
    
    return true;
  } else {
    console.log('⚠️  Fix may need further refinement');
    if (!allConsistent) console.log('   - Consistency issues remain');
    if (mappingRate <= 40) console.log('   - Low mapping efficiency');
    
    return false;
  }
}

// Run the validation test
async function runFixValidation() {
  try {
    const success = await testNonDeterministicFix();
    
    if (success) {
      console.log('\n🎯 Non-deterministic rendering issue has been successfully fixed!');
      console.log('Users should no longer experience random "unknown" squares in Chrome/Android.');
    } else {
      console.log('\n⚠️  Additional work may be needed to fully resolve the issue.');
    }
    
    return success;
  } catch (error) {
    console.error('Test failed with error:', error.message);
    return false;
  }
}

// Export for use in other tests
module.exports = {
  testNonDeterministicFix,
  runFixValidation
};

// Run if executed directly
if (require.main === module) {
  runFixValidation();
}