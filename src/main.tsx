import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Root from './Root.tsx'
import { applyTheme, loadTheme } from './utils/theme'
import { initCloudSync } from './utils/cloudSync'

// 描画前にテーマを反映して、ダークモード時の白い画面のちらつきを防ぐ
applyTheme(loadTheme())
// ログイン中ならクラウド（Supabase）との同期を始める
initCloudSync()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
