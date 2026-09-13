import { Route, Routes } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import BusinessDetail from './pages/BusinessDetail'
import { UpdatePrompt } from './components/UpdatePrompt'

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/business/:id" element={<BusinessDetail />} />
      </Routes>
      <UpdatePrompt />
    </>
  )
}
