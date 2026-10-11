import pg from 'pg';import{config}from'../config.js';
export const pool=new pg.Pool({connectionString:config.DATABASE_URL,max:15,idleTimeoutMillis:30000,connectionTimeoutMillis:5000,ssl:process.env.PGSSLMODE==='require'?{rejectUnauthorized:true}:undefined});
pool.on('error',err=>console.error('Unexpected PostgreSQL pool error',err));
