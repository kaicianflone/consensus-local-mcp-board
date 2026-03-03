import React from 'react';
import { Link } from 'react-router-dom';

export default function HomePage() {
  return (
    <div className='container'>
      <h1>Consensus Local MCP Board</h1>
      <p className='small'>Choose your workspace.</p>

      <div className='grid two'>
        <Link to='/workflows' className='card nav-card'>
          <h2>Workflows</h2>
          <p className='small'>Visual builder for agent/guard/HITL flows with run observability.</p>
        </Link>

        <Link to='/boards' className='card nav-card'>
          <h2>Boards</h2>
          <p className='small'>Decision ledger, runs, votes, audit trail, and guard artifacts.</p>
        </Link>
      </div>
    </div>
  );
}
