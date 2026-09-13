// ==============================================================================
// Database Connection Client using Native Bun SQL
// ==============================================================================

import { SQL } from 'bun';

export class DBClient {
  private sqlInstance: any = null;
  private connected = false;

  constructor(private connectionString?: string) {
    this.connectionString = connectionString || process.env.DATABASE_URL || 'postgres://maps6:maps6_secret@postgres:5432/maps6';
  }

  async connect(retries = 5, delayMs = 2000): Promise<boolean> {
    for (let i = 1; i <= retries; i++) {
      try {
        const client = new SQL(this.connectionString!);
        // Test query
        await client`SELECT 1`;
        this.sqlInstance = client;
        this.connected = true;
        console.log('[DBClient] Successfully connected to PostgreSQL via native Bun SQL');
        return true;
      } catch (err) {
        console.warn(`[DBClient] Connection attempt ${i}/${retries} failed: ${(err as Error).message}`);
        if (i < retries) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    }

    console.warn('[DBClient] Could not connect to PostgreSQL after retries (running in fallback/mock mode)');
    this.connected = false;
    return false;
  }

  get sql(): any {
    return this.sqlInstance;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async close(): Promise<void> {
    if (this.sqlInstance) {
      await this.sqlInstance.close();
      this.sqlInstance = null;
      this.connected = false;
    }
  }
}

export const dbClient = new DBClient();
