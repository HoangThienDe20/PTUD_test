import { useState, useEffect } from 'react'
import { Server, Users, AlertCircle, TrendingUp, Thermometer } from 'lucide-react'
import api from '../api'

const STAT_STYLES = {
  cyan: {
    card: 'border-neon-cyan/30 hover:border-neon-cyan/60 hover:shadow-neon-cyan/20',
    iconWrap: 'bg-neon-cyan/20',
    icon: 'text-neon-cyan',
    value: 'text-neon-cyan',
  },
  purple: {
    card: 'border-neon-purple/30 hover:border-neon-purple/60 hover:shadow-neon-purple/20',
    iconWrap: 'bg-neon-purple/20',
    icon: 'text-neon-purple',
    value: 'text-neon-purple',
  },
  yellow: {
    card: 'border-neon-yellow/30 hover:border-neon-yellow/60 hover:shadow-neon-yellow/20',
    iconWrap: 'bg-neon-yellow/20',
    icon: 'text-neon-yellow',
    value: 'text-neon-yellow',
  },
  orange: {
    card: 'border-neon-orange/30 hover:border-neon-orange/60 hover:shadow-neon-orange/20',
    iconWrap: 'bg-neon-orange/20',
    icon: 'text-neon-orange',
    value: 'text-neon-orange',
  },
  green: {
    card: 'border-neon-green/30 hover:border-neon-green/60 hover:shadow-neon-green/20',
    iconWrap: 'bg-neon-green/20',
    icon: 'text-neon-green',
    value: 'text-neon-green',
  },
  red: {
    card: 'border-neon-red/30 hover:border-neon-red/60 hover:shadow-neon-red/20',
    iconWrap: 'bg-neon-red/20',
    icon: 'text-neon-red',
    value: 'text-neon-red',
  },
}

export default function AdminDashboard() {
  const [stats, setStats] = useState({
    totalServers: 0,
    totalUsers: 0,
    pendingUsers: 0,
    totalAlerts: 0,
    totalRevenue: 0,
    totalIoTDevices: 0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchStats()
    const interval = setInterval(fetchStats, 30000)
    return () => clearInterval(interval)
  }, [])

  const fetchStats = async () => {
    try {
      setLoading(true)
      const [serversRes, usersRes, alertsRes, iotDevicesRes] = await Promise.all([
        api.get('/api/servers/admin/servers').catch(() => ({ data: { servers: [] } })),
        api.get('/api/admin/users').catch(() => ({ data: { users: [] } })),
        api.get('/api/alerts').catch(() => ({ data: { alerts: [] } })),
        api.get('/api/admin/iot-devices').catch(() => ({ data: { devices: [] } })),
      ])

      const servers = serversRes.data.servers || []
      const users = usersRes.data.users || []
      const alerts = alertsRes.data.alerts || []
      const iotDevices = iotDevicesRes.data.devices || []

      const totalRevenue = servers.reduce((sum, s) => {
        const monthlyRevenue = Number(s.price_per_month || 0) * (s.subscribers_count || 0)
        return sum + monthlyRevenue
      }, 0)

      setStats({
        totalServers: servers.length,
        totalUsers: users.length,
        pendingUsers: users.filter((u) => !u.is_approved).length,
        totalAlerts: alerts.length,
        totalRevenue,
        totalIoTDevices: iotDevices.length,
      })
    } catch (err) {
      console.error('Failed to fetch stats:', err)
    } finally {
      setLoading(false)
    }
  }

  const StatCard = ({ icon: Icon, label, value, tone, unit = '' }) => {
    const style = STAT_STYLES[tone] || STAT_STYLES.cyan
    return (
      <div className={`bg-dark-800 border rounded-xl p-6 transition-all hover:shadow-lg ${style.card}`}>
        <div className="flex items-start justify-between mb-4">
          <div className={`p-3 rounded-lg ${style.iconWrap}`}>
            <Icon className={`w-6 h-6 ${style.icon}`} />
          </div>
        </div>
        <p className="text-gray-400 text-sm mb-2">{label}</p>
        <p className={`text-3xl font-bold ${style.value}`}>{loading ? '-' : `${value}${unit}`}</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-dark-900 p-8">
      <div className="mb-12">
        <h1 className="text-4xl font-bold text-white mb-2">Admin Dashboard</h1>
        <p className="text-gray-400">System overview and key metrics</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <StatCard icon={Server} label="Total Servers" value={stats.totalServers} tone="cyan" />
        <StatCard icon={Users} label="Total Users" value={stats.totalUsers} tone="purple" />
        <StatCard icon={AlertCircle} label="Pending Users" value={stats.pendingUsers} tone="yellow" />
        <StatCard icon={AlertCircle} label="Total Alerts" value={stats.totalAlerts} tone="orange" />
        <StatCard icon={TrendingUp} label="Monthly Revenue" value={stats.totalRevenue.toFixed(2)} tone="green" unit=" $" />
        <StatCard icon={Thermometer} label="Total IoT Devices" value={stats.totalIoTDevices} tone="red" />
      </div>
    </div>
  )
}
