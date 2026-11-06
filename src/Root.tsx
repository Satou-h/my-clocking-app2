import App from './App';
import { AuthLoading, LoginScreen, PasswordResetScreen, SetupScreen } from './components/AuthScreens';
import { appGate, useCloudState } from './utils/cloudSync';

/**
 * 最初にログイン画面を出し、ログインが済んだら（必要ならどちらのデータを使うか選んでから）いつもの画面にする。
 */
export default function Root() {
  const cloud = useCloudState();
  switch (appGate(cloud)) {
    case 'app': return <App />;
    case 'loading': return <AuthLoading />;
    case 'reset': return <PasswordResetScreen />;
    case 'setup': return <SetupScreen />;
    case 'login': return <LoginScreen />;
  }
}
