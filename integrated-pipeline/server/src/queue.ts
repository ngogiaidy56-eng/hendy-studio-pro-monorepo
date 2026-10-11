import IORedis from'ioredis';import{Queue}from'bullmq';import{config}from'./config.js';
export const redis=new IORedis(config.REDIS_URL,{maxRetriesPerRequest:null,enableReadyCheck:true});redis.on('error',err=>console.error('Redis connection error',err));
export const renderQueue=new Queue('hendy-render',{connection:redis,defaultJobOptions:{attempts:2,backoff:{type:'exponential',delay:2000},removeOnComplete:{age:86400,count:1000},removeOnFail:{age:604800,count:2000}}});
