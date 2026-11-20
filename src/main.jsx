import React from 'react'
import ReactDOM from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import App from './App.jsx'
import { MOTION, CALM } from './motion.jsx'
import './styles.css'
import './sections.css'

document.documentElement.classList.toggle('motion', MOTION)
document.documentElement.classList.toggle('calm', CALM)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <Analytics />
  </React.StrictMode>,
)
