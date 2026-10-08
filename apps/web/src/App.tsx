import { Route, Routes } from 'react-router';
import { PageShell } from './components/ui';
import { AnalysisPage } from './pages/AnalysisPage';
import { LandingPage } from './pages/LandingPage';
import { MaterialPage } from './pages/MaterialPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PlanPage } from './pages/PlanPage';
import { ProgressPage } from './pages/ProgressPage';
import { SetupPage } from './pages/SetupPage';
import { TodayPage } from './pages/TodayPage';
import { TopicPage } from './pages/TopicPage';

export function App() {
  return (
    <PageShell>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/material" element={<MaterialPage />} />
        <Route path="/analysis" element={<AnalysisPage />} />
        <Route path="/plan" element={<PlanPage />} />
        <Route path="/today" element={<TodayPage />} />
        <Route path="/topics/:topicId" element={<TopicPage />} />
        <Route path="/progress" element={<ProgressPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </PageShell>
  );
}
