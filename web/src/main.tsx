import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import BoardsPage from './pages/BoardsPage';
import BoardDetailPage from './pages/BoardDetailPage';
import RunDetailPage from './pages/RunDetailPage';
import './styles.css';

function App(){
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path='/' element={<Navigate to='/local-board' replace />} />
        <Route path='/local-board' element={<BoardsPage />} />
        <Route path='/local-board/:boardId' element={<BoardDetailPage />} />
        <Route path='/local-board/run/:runId' element={<RunDetailPage />} />
      </Routes>
    </BrowserRouter>
  );
}

createRoot(document.getElementById('root')!).render(<App/>);
