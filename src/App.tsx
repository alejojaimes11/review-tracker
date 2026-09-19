import { Route, Routes } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import BusinessDetail from './pages/BusinessDetail'
import AdminLogin from './pages/AdminLogin'
import { UpdatePrompt } from './components/UpdatePrompt'

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/admin" element={<AdminLogin />} />
        <Route path="/business/:id" element={<BusinessDetail />} />
      </Routes>
      <UpdatePrompt />
    </>
  )
}
