import { createContext, useContext, useState, useEffect } from 'react'
import { useAuth } from './AuthContext'
import api from '../api'

const DeviceContext = createContext()

export function DeviceProvider({ children }) {
  const { user, token } = useAuth()
  const isDev = import.meta.env.DEV
  
  // IoT Devices (user-owned)
  const [iotDevices, setIotDevices] = useState([])
  const [selectedIoTDevice, setSelectedIoTDevice] = useState(null)
  
  // Admin view: all user IoT devices
  const [allIoTDevices, setAllIoTDevices] = useState([])
  
  // Servers (admin-created, user-subscribed)
  const [availableServers, setAvailableServers] = useState([])
  const [myServers, setMyServers] = useState([])
  const [selectedServer, setSelectedServer] = useState(null)
  
  // State
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Fetch IoT devices on mount
  useEffect(() => {
    if (user && token) {
      if (isDev) console.log('DeviceContext: User loaded, role:', user.role)
      if (user.role === 'admin') {
        if (isDev) console.log('User is admin, fetching ALL devices...')
        fetchAllIoTDevices()
      } else {
        if (isDev) console.log('User is regular user, fetching MY devices...')
        fetchIoTDevices()
      }
      fetchMyServers()
      fetchAvailableServers()
    }
  }, [user, token, isDev])

  // ============== IoT DEVICES ==============
  
  const fetchIoTDevices = async () => {
    try {
      setLoading(true)
      const response = await api.get('/api/iot-devices')
      setIotDevices(response.data.devices || [])
      
      // Auto-select first device
      if (response.data.devices?.length > 0 && !selectedIoTDevice) {
        setSelectedIoTDevice(response.data.devices[0].id)
      }
    } catch (err) {
      console.error('Failed to fetch IoT devices:', err)
    } finally {
      setLoading(false)
    }
  }

  const createIoTDevice = async (deviceData) => {
    try {
      const response = await api.post('/api/iot-devices', deviceData)
      setIotDevices([...iotDevices, response.data])
      return response.data
    } catch (err) {
      throw err
    }
  }

  const updateIoTDevice = async (deviceId, updates) => {
    try {
      const response = await api.put(`/api/iot-devices/${deviceId}`, updates)
      setIotDevices(iotDevices.map(d => d.id === deviceId ? response.data : d))
      return response.data
    } catch (err) {
      throw err
    }
  }

  const deleteIoTDevice = async (deviceId) => {
    try {
      await api.delete(`/api/iot-devices/${deviceId}`)
      setIotDevices(iotDevices.filter(d => d.id !== deviceId))
      if (selectedIoTDevice === deviceId) {
        setSelectedIoTDevice(iotDevices.length > 1 ? iotDevices[0].id : null)
      }
    } catch (err) {
      throw err
    }
  }

  // ============== ADMIN: IoT DEVICE MANAGEMENT ==============

  const fetchAllIoTDevices = async () => {
    try {
      setLoading(true)
      if (isDev) console.log('Fetching ALL IoT devices for admin...')
      const response = await api.get('/api/admin/iot-devices')
      if (isDev) console.log('API Response:', response.data)
      // Should return { devices: [...], count: X }
      setAllIoTDevices(response.data.devices || [])
      if (isDev) console.log('AllIoTDevices updated:', response.data.devices)
    } catch (err) {
      console.error('Failed to fetch all IoT devices:', err)
      setError(err.message)
      setAllIoTDevices([])  // Set to empty array on error
    } finally {
      setLoading(false)
    }
  }

  const deleteIoTDeviceAdmin = async (deviceId) => {
    try {
      await api.delete(`/api/admin/iot-devices/${deviceId}`)
      setAllIoTDevices(allIoTDevices.filter(d => d.id !== deviceId))
      return true
    } catch (err) {
      throw err
    }
  }

  const disconnectIoTDevice = async (deviceId) => {
    try {
      const response = await api.put(`/api/admin/iot-devices/${deviceId}/disconnect`)
      setAllIoTDevices(allIoTDevices.map(d => 
        d.id === deviceId ? { ...d, is_active: false } : d
      ))
      return response.data
    } catch (err) {
      throw err
    }
  }

  const reconnectIoTDevice = async (deviceId) => {
    try {
      const response = await api.put(`/api/admin/iot-devices/${deviceId}/reconnect`)
      setAllIoTDevices(allIoTDevices.map(d => 
        d.id === deviceId ? { ...d, is_active: true } : d
      ))
      return response.data
    } catch (err) {
      throw err
    }
  }

  // ============== SERVERS ==============
  
  const fetchAvailableServers = async () => {
    try {
      const response = await api.get('/api/servers')
      if (isDev) console.log('[DeviceContext] Fetched available servers:', response.data?.servers)
      setAvailableServers(response?.data?.servers || [])
    } catch (err) {
      console.error('Failed to fetch available servers:', err)
      setAvailableServers([])
    }
  }

  const fetchMyServers = async () => {
    try {
      const response = await api.get('/api/servers/my-subscriptions')
      setMyServers(response?.data?.servers || [])
      
      // Auto-select first server
      if (response?.data?.servers?.length > 0 && !selectedServer) {
        setSelectedServer(response.data.servers[0].server_id || response.data.servers[0].id)
      }
    } catch (err) {
      console.error('Failed to fetch my servers:', err)
      setMyServers([])
    }
  }

  const subscribeToServer = async (serverId, durationMonths = 1) => {
    throw new Error('Server subscription approval flow has been removed. Use the rental code flow instead.')
  }

  const unsubscribeFromServer = async (serverId) => {
    throw new Error('Server subscription approval flow has been removed. Use rental cancellation instead.')
  }

  // ============== ADMIN FUNCTIONS ==============
  
  const createServer = async (serverData) => {
    throw new Error('Server creation is managed by remote agent registration.')
  }

  const deleteServer = async (serverId) => {
    throw new Error('Server deletion is not exposed in remote monitoring mode.')
  }

  const value = {
    // IoT Devices
    iotDevices,
    selectedIoTDevice,
    setSelectedIoTDevice,
    createIoTDevice,
    updateIoTDevice,
    deleteIoTDevice,
    fetchIoTDevices,
    
    // Admin IoT Device Management
    allIoTDevices,
    fetchAllIoTDevices,
    deleteIoTDeviceAdmin,
    disconnectIoTDevice,
    reconnectIoTDevice,
    
    // Servers
    availableServers,
    myServers,
    selectedServer,
    setSelectedServer,
    subscribeToServer,
    unsubscribeFromServer,
    fetchMyServers,
    fetchAvailableServers,
    
    // Admin
    createServer,
    deleteServer,
    
    // State
    loading,
    error,
  }

  return (
    <DeviceContext.Provider value={value}>
      {children}
    </DeviceContext.Provider>
  )
}

export function useDevices() {
  const context = useContext(DeviceContext)
  if (!context) {
    throw new Error('useDevices must be used within DeviceProvider')
  }
  return context
}
