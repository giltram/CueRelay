import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { startDiagnostics } from './diagnostics';
import { draftTab } from './workspace-drafts/tab';

startDiagnostics();
// Reclaim the tab identity before account and project requests complete.
// Workbench reports a failed claim when it needs draft storage.
void draftTab().catch(() => {});

createRoot(document.getElementById('root')!).render(<App />);
