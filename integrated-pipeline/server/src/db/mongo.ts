import{MongoClient,Db}from'mongodb';import{config}from'../config.js';
const client=new MongoClient(config.MONGODB_URI,{serverSelectionTimeoutMS:5000});let database:Db;
export async function connectMongo(){await client.connect();database=client.db(config.MONGODB_DATABASE);await database.collection('projects').createIndex({ownerId:1,updatedAt:-1});await database.collection('projects').createIndex({ownerId:1,title:1});console.log('MongoDB connected');}
export function mongoDb(){if(!database)throw new Error('MongoDB has not initialized');return database;}
export async function closeMongo(){await client.close();}
