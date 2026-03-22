const { getRedisClient, isRedisReady, initializeRedis } = require('./redisClient');

(async () => {
  try {
    console.log('Initializing Redis connection...');
    await initializeRedis();
    
    if (!isRedisReady()) {
      console.log('✓ Redis not connected - IP blocks are not active anyway');
      process.exit(0);
    }
    
    const redis = getRedisClient();
    
    // Get all XSS blocked IPs
    const keys = await redis.keys('xss:blocked:*');
    console.log(`Found ${keys.length} blocked IPs`);
    
    // Delete all blocks
    if (keys.length > 0) {
      await redis.del(...keys);
      console.log('✓ Cleared all IP blocks');
    } else {
      console.log('✓ No IPs were blocked');
    }
    
    // Also clear attack counters
    const attackKeys = await redis.keys('xss:attacks:*');
    if (attackKeys.length > 0) {
      await redis.del(...attackKeys);
      console.log(`✓ Cleared ${attackKeys.length} attack counters`);
    }
    
    console.log('\n✓ Your IP is now unblocked!');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();
