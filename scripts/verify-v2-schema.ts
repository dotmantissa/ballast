import './db-transport';
import assert from 'node:assert/strict';
import {neon,neonConfig} from '@neondatabase/serverless';
neonConfig.fetchEndpoint=host=>`https://${host}/sql`;
const sql=neon(process.env.DATABASE_URL!);
const schema=process.env.BALLAST_MIGRATION_SCHEMA??'public';
const columns=await sql`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=${schema} AND table_name IN ('ballast_jobs','ballast_operations','ballast_monitoring','ballast_sponsor_state')`;
for(const [table,column] of [['ballast_jobs','epoch'],['ballast_jobs','segment'],['ballast_operations','deployment_id'],['ballast_operations','action'],['ballast_monitoring','evidence_digest'],['ballast_sponsor_state','lease_until']])assert.ok(columns.some(r=>r.table_name===table&&r.column_name===column),`${table}.${column} is missing`);
console.log(`V2 additive schema verified in ${schema}.`);
