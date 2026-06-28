import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

export const db = new Pool({ connectionString: config.DATABASE_URL });
