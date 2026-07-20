/**
 * Faux pool mysql2 pour les tests : on empile des réponses (queue) et on
 * enregistre chaque requête exécutée. Simule aussi getConnection() pour
 * vérifier le cycle transactionnel (begin/commit/rollback/release).
 *
 * Formats de réponse identiques à mysql2 :
 *   SELECT → [rows]            ex. [[{ id: 'g1' }]]
 *   UPDATE/INSERT → [result]   ex. [{ affectedRows: 1 }]
 *   Une instance d'Error dans la queue est levée à la place.
 */
export class FakePool {
  constructor() {
    this.responses = [];
    this.calls = [];
    this.tx = [];
  }

  queue(...responses) {
    this.responses.push(...responses);
    return this;
  }

  async execute(sql, params) {
    this.calls.push({ sql, params });
    if (!this.responses.length) {
      throw new Error(`Requête inattendue (queue vide) : ${sql.slice(0, 80)}`);
    }
    const r = this.responses.shift();
    if (r instanceof Error) throw r;
    return r;
  }

  async getConnection() {
    const pool = this;
    return {
      async beginTransaction() { pool.tx.push('begin'); },
      async commit() { pool.tx.push('commit'); },
      async rollback() { pool.tx.push('rollback'); },
      release() { pool.tx.push('release'); },
      execute(sql, params) { return pool.execute(sql, params); },
    };
  }
}
