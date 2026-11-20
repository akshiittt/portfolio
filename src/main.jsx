import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { MOTION } from './motion.jsx'
import './styles.css'
import './sections.css'

document.documentElement.classList.toggle('motion', MOTION)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
