import { useState, useEffect, useRef } from 'react'
import { Plus, Trash2, Edit2, Home, Radio, X, Power, PowerOff, AlertCircle, Settings, Wifi, RefreshCcw } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { useDevices } from '../context/DeviceContext'
import { useAuth } from '../context/AuthContext'
import { useNotification } from '../context/NotificationContext'
import AddDeviceModal from './AddDeviceModal'
import EditAlertThresholdsModal from './EditAlertThresholdsModal'
import api from '../api'
import { formatVNTime } from '../utils/vnTime'

export default function IoTDeviceManager() {
  const { iotDevices, allIoTDevices, createIoTDevice, updateIoTDevice, deleteIoTDevice, fetchIoTDevices, fetchAllIoTDevices } = useDevices()
  const { user } = useAuth()
  const { notify } = useNotification()
  const isAdmin = user?.role === 'admin'
  const isDev = import.meta.env.DEV
  const SHOW_DEVICE_UPDATED_TIME = true
  
  // Use allIoTDevices if admin, otherwise use iotDevices
  const displayDevices = isAdmin ? allIoTDevices : iotDevices
  
  // ADMIN: State for admin summary view
  const [adminSummary, setAdminSummary] = useState({
    users_summary: [],
    total_devices: 0,
    total_users: 0
  })

  // Admin table must show normal users only (hide admin accounts).
  const userOnlySummary = (adminSummary?.users_summary || []).filter(
    (item) => item?.role === 'user' || (!item?.role && item?.username !== 'admin' && item?.email !== 'admin@example.com')
  )
  
  // ADMIN: Fetch admin summary data
  useEffect(() => {
    if (isAdmin) {
      const fetchAdminSummary = async () => {
        try {
          const response = await api.get('/api/admin/iot-devices/users-summary')
          setAdminSummary(response.data)
          if (isDev) console.log('Admin summary fetched:', response.data)
        } catch (error) {
          console.error('Failed to fetch admin summary:', error)
          setAdminSummary({
            users_summary: [],
            total_devices: 0,
            total_users: 0
          })
        }
      }
      fetchAdminSummary()
      // Refresh every 10 seconds
      const interval = setInterval(fetchAdminSummary, 10000)
      return () => clearInterval(interval)
    }
  }, [isAdmin])
  
  // Keep debug logs only in development.
  useEffect(() => {
    if (!isDev) return
    if (isDev) console.log('IoTDeviceManager devices:', displayDevices?.length || 0)
  }, [isDev, displayDevices?.length])
  const wsRef = useRef(null)
  const devicesRef = useRef([])
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showAddDeviceModal, setShowAddDeviceModal] = useState(false)
  const [showChartModal, setShowChartModal] = useState(false)
  const [showAlertThresholdsModal, setShowAlertThresholdsModal] = useState(false)
  const [showSensorContextModal, setShowSensorContextModal] = useState(false)
  const [selectedDeviceForChart, setSelectedDeviceForChart] = useState(null)
  const [selectedDeviceForAlert, setSelectedDeviceForAlert] = useState(null)
  const [selectedDeviceForContext, setSelectedDeviceForContext] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [sensorContextForm, setSensorContextForm] = useState({
    environment_type: 'indoor',
    location_query: '',
    task_description: '',
    priority_level: 'medium',
    action_hint: '',
  })
  const [savingSensorContext, setSavingSensorContext] = useState(false)
  const [checkingContextLocation, setCheckingContextLocation] = useState(false)
  const [contextLocationCheck, setContextLocationCheck] = useState({
    checked: false,
    success: false,
    message: '',
  })
  const VIETNAM_PROVINCES = [
    'An Giang, Vietnam', 'Ba Ria - Vung Tau, Vietnam', 'Bac Giang, Vietnam', 'Bac Kan, Vietnam', 'Bac Lieu, Vietnam',
    'Bac Ninh, Vietnam', 'Ben Tre, Vietnam', 'Binh Dinh, Vietnam', 'Binh Duong, Vietnam', 'Binh Phuoc, Vietnam',
    'Binh Thuan, Vietnam', 'Ca Mau, Vietnam', 'Can Tho, Vietnam', 'Cao Bang, Vietnam', 'Da Nang, Vietnam',
    'Dak Lak, Vietnam', 'Dak Nong, Vietnam', 'Dien Bien, Vietnam', 'Dong Nai, Vietnam', 'Dong Thap, Vietnam',
    'Gia Lai, Vietnam', 'Ha Giang, Vietnam', 'Ha Nam, Vietnam', 'Ha Noi, Vietnam', 'Ha Tinh, Vietnam',
    'Hai Duong, Vietnam', 'Hai Phong, Vietnam', 'Hau Giang, Vietnam', 'Hoa Binh, Vietnam', 'Hung Yen, Vietnam',
    'Hue, Vietnam', 'Khanh Hoa, Vietnam', 'Kien Giang, Vietnam', 'Kon Tum, Vietnam', 'Lai Chau, Vietnam',
    'Lam Dong, Vietnam', 'Lang Son, Vietnam', 'Lao Cai, Vietnam', 'Long An, Vietnam', 'Nam Dinh, Vietnam',
    'Nghe An, Vietnam', 'Ninh Binh, Vietnam', 'Ninh Thuan, Vietnam', 'Phu Tho, Vietnam', 'Phu Yen, Vietnam',
    'Quang Binh, Vietnam', 'Quang Nam, Vietnam', 'Quang Ngai, Vietnam', 'Quang Ninh, Vietnam', 'Quang Tri, Vietnam',
    'Soc Trang, Vietnam', 'Son La, Vietnam', 'Tay Ninh, Vietnam', 'Thai Binh, Vietnam', 'Thai Nguyen, Vietnam',
    'Thanh Hoa, Vietnam', 'Tien Giang, Vietnam', 'Ho Chi Minh City, Vietnam', 'Tra Vinh, Vietnam', 'Tuyen Quang, Vietnam',
    'Vinh Long, Vietnam', 'Vinh Phuc, Vietnam', 'Yen Bai, Vietnam'
  ]
  const [formData, setFormData] = useState({
    name: '',
    device_type: 'temperature',
    source: '',
    unit: '°C',
    location: '',
    environment_type: 'indoor',
    min_threshold: '',
    max_threshold: '',
    is_active: true
  })
  const [loading, setLoading] = useState(false)
  const [addingDevice, setAddingDevice] = useState(false)
  const [latestMetrics, setLatestMetrics] = useState({})
  const [chartData, setChartData] = useState([])
  const [shortForecast, setShortForecast] = useState([])
  const [chartLoading, setChartLoading] = useState(false)
  const [chartStats, setChartStats] = useState({
    average: 0,
    min: 0,
    max: 0
  })
  const [deviceOwners, setDeviceOwners] = useState({})
  const [chartLastUpdated, setChartLastUpdated] = useState(null)
  const [savingAlerts, setSavingAlerts] = useState(false)
  const [showNotificationSettings, setShowNotificationSettings] = useState(false)
  const [showTelegramGuide, setShowTelegramGuide] = useState(false)
  const [openSettingsMenuId, setOpenSettingsMenuId] = useState(null)
  const [notificationTargets, setNotificationTargets] = useState([])
  const [newTelegramChatId, setNewTelegramChatId] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [showWifiModal, setShowWifiModal] = useState(false)
  const [selectedDeviceForWifi, setSelectedDeviceForWifi] = useState(null)
  const [wifiForm, setWifiForm] = useState({ ssid: '', password: '' })
  const [wifiNetworks, setWifiNetworks] = useState([])
  const [wifiReceivedAt, setWifiReceivedAt] = useState('')
  const [wifiStatus, setWifiStatus] = useState(null)
  const [wifiLoading, setWifiLoading] = useState(false)
  const [wifiSubmitting, setWifiSubmitting] = useState(false)
  const [deviceCommandLoading, setDeviceCommandLoading] = useState({})
  const latestMetricsInFlightRef = useRef(false)
  const historyEndpointSupportedRef = useRef(true)
  const getMetricValue = (m) => m?.metric_value ?? m?.value
  const getMetricTimestamp = (m) => m?.event_ts ?? m?.timestamp

  useEffect(() => {
    devicesRef.current = displayDevices || []
  }, [displayDevices])

  useEffect(() => {
    const closeSettingsMenu = () => setOpenSettingsMenuId(null)
    document.addEventListener('click', closeSettingsMenu)
    return () => document.removeEventListener('click', closeSettingsMenu)
  }, [])

  useEffect(() => {
    if (isAdmin) return
    const loadNotificationSettings = async () => {
      try {
        const res = await api.get('/api/auth/notifications/targets')
        setNotificationTargets(res.data?.targets || [])
      } catch (err) {
        console.error('Failed to load notification settings:', err)
      }
    }
    loadNotificationSettings()
  }, [isAdmin])

  // Fetch owner information for all devices
  useEffect(() => {
    const fetchOwnerInfo = async () => {
      try {
        const owners = {}
        
        // Fetch owner info for each device
        for (const device of displayDevices) {
          if (device.user_id) {
            try {
              const response = await api.get(`/api/auth/users/${device.user_id}`)
              owners[device.id] = response.data.username || response.data.email
              if (isDev) console.log(`Fetched owner for device ${device.id}:`, owners[device.id])
            } catch (err) {
              console.error(`Failed to fetch owner for device ${device.id}:`, err)
              owners[device.id] = `User #${device.user_id}`
            }
          }
        }
        
        setDeviceOwners(owners)
        if (isDev) console.log('All device owners fetched:', owners)
      } catch (err) {
        console.error('Failed to fetch owner information:', err)
      }
    }

    if (displayDevices.length > 0) {
      fetchOwnerInfo()
    }
  }, [displayDevices])

  // Fetch latest metrics for all devices
  useEffect(() => {
    const fetchLatestMetrics = async () => {
      if (latestMetricsInFlightRef.current) return
      if (document.visibilityState === 'hidden') return
      try {
        latestMetricsInFlightRef.current = true
        const metrics = {}
        const response = await api.get('/api/iot-devices/realtime', {
          params: { _t: Date.now() },
          headers: {
            'Cache-Control': 'no-store',
            Pragma: 'no-cache',
            Expires: '0',
          },
        })
        const devices = response.data?.devices || []
        devices.forEach((device) => {
          metrics[device.id] = {
            value: device.latest_value,
            timestamp: device.latest_event_ts,
            server_now: device.server_now || response.data?.server_now,
            source: device.source,
            metric_type: device.metric_type || device.device_type,
            alert_status: device.alert_status,
          }
        })
        if (isDev) {
          console.log('[REALTIME UI] fetched at', new Date(), devices)
        }
        setLatestMetrics(metrics)
      } catch (err) {
        console.error('Failed to fetch latest metrics:', err)
      } finally {
        latestMetricsInFlightRef.current = false
      }
    }

    // Fetch immediately and then every 1 second for realtime IoT cards.
    fetchLatestMetrics()
    const interval = setInterval(fetchLatestMetrics, 1000)
    return () => clearInterval(interval)
  }, [displayDevices, isDev])

  // Connect to WebSocket for realtime IoT data updates
  useEffect(() => {
    const connectWebSocket = () => {
      try {
        const coreServerUrl = import.meta.env.VITE_CORE_SERVER_IP || import.meta.env.VITE_SERVER_IP || 'localhost'
        const corePort = import.meta.env.VITE_CORE_SERVER_PORT || import.meta.env.VITE_SERVER_PORT || '8000'
        const iotServerUrl = coreServerUrl
        const iotPort = corePort
        const clientId = `frontend_iot_${Date.now()}`
        const token = localStorage.getItem('access_token') || ''
        const wsUrl = `ws://${iotServerUrl}:${iotPort}/api/ws/${clientId}?token=${encodeURIComponent(token)}`
        
        if (isDev) console.log('[IoTDeviceManager] Connecting to WebSocket:', wsUrl)
        wsRef.current = new WebSocket(wsUrl)
        
        wsRef.current.onopen = () => {
          if (isDev) console.log('[IoTDeviceManager] WebSocket connected for realtime updates')
        }
        
        wsRef.current.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data)
            
            // Handle realtime IoT metric broadcasts
            if (message.type === 'iot_metric' && message.metric_type && message.value !== undefined) {
              const messageSource = message.source || message.sensor_id
              setLatestMetrics(prev => {
                const updated = { ...prev }
                // Realtime values are scoped by both device source and metric type.
                ;(devicesRef.current || []).forEach(device => {
                  if (
                    device.device_type === message.metric_type &&
                    device.source === messageSource
                  ) {
                    updated[device.id] = {
                      value: message.value,
                      timestamp: message.timestamp,
                      source: messageSource,
                      metric_type: message.metric_type
                    }
                  }
                })
                return updated
              })
            }
          } catch (err) {
            console.error('[IoTDeviceManager] Failed to parse WebSocket data:', err)
          }
        }
        
        wsRef.current.onerror = (event) => {
          if (isDev) {
            console.error('[IoTDeviceManager] WebSocket error:', event)
            console.error('[IoTDeviceManager] WebSocket ready state:', wsRef.current?.readyState)
          }
        }
        
        wsRef.current.onclose = () => {
          if (isDev) console.log('[IoTDeviceManager] WebSocket disconnected, reconnecting...')
          setTimeout(connectWebSocket, 3000)
        }
      } catch (err) {
        if (isDev) console.error('[IoTDeviceManager] Failed to connect WebSocket:', err)
      }
    }
    
    connectWebSocket()
    
    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [isDev])

  // Helper function to aggregate data by minute (1 point per minute)
  const aggregateDataByMinute = (rawData) => {
    if (!rawData || rawData.length === 0) return []
    
    // Group data by minute
    const minuteGroups = {}
    rawData.forEach(item => {
      const date = new Date(getMetricTimestamp(item))
      // Round to nearest minute
      date.setSeconds(0, 0)
      const minuteKey = date.getTime()
      
      if (!minuteGroups[minuteKey]) {
        minuteGroups[minuteKey] = []
      }
      minuteGroups[minuteKey].push(getMetricValue(item))
    })
    
    // Calculate average for each minute and format
    const aggregatedData = Object.keys(minuteGroups)
      .sort((a, b) => parseInt(a) - parseInt(b))
      .map(minuteKey => {
        const values = minuteGroups[minuteKey]
        const avgValue = values.reduce((a, b) => a + b, 0) / values.length
        const date = new Date(parseInt(minuteKey))
        
        return {
          time: formatVNTime(date),
          value: parseFloat(avgValue.toFixed(2)),
          timestamp: date.getTime()
        }
      })
    
    return aggregatedData
  }

  const mergeShortForecast = (actualData, predictions) => {
    if (!actualData?.length) return actualData || []
    const merged = actualData.map((point) => ({ ...point, predictedValue: null }))
    const lastActual = merged[merged.length - 1]
    const lastTs = Number(lastActual?.timestamp || 0)
    if (!lastTs) return merged

    if (predictions?.length) {
      merged.push({
        time: lastActual.time,
        timestamp: lastTs,
        value: null,
        predictedValue: Number(lastActual.value),
      })
    }

    for (const point of predictions || []) {
      const ts = new Date(point?.timestamp)
      const value = Number(point?.predicted_value ?? point?.predictedValue)
      if (Number.isNaN(ts.getTime()) || Number.isNaN(value)) continue
      if (ts.getTime() <= lastTs) continue
      merged.push({
        time: formatVNTime(ts),
        timestamp: ts.getTime(),
        value: null,
        predictedValue: Number(value.toFixed(2)),
      })
    }

    return merged.sort((a, b) => Number(a.timestamp) - Number(b.timestamp))
  }

  const buildLocalForecastFallback = (actualData) => {
    if (!actualData?.length) return []
    const points = [...actualData]
    const last = points[points.length - 1]
    const lastTs = Number(last.timestamp || Date.now())
    const recent = points.slice(-6).map((item) => Number(item.value)).filter((v) => !Number.isNaN(v))
    const slope = recent.length >= 2 ? (recent[recent.length - 1] - recent[0]) / (recent.length - 1) : 0
    const predictions = []
    for (let i = 1; i <= 6; i += 1) {
      const ts = new Date(lastTs + i * 5 * 60 * 1000)
      predictions.push({
        timestamp: ts.toISOString(),
        predicted_value: Number((Number(last.value) + slope * i).toFixed(2)),
      })
    }
    return predictions
  }

  const fetchShortForecast = async (device, actualData) => {
    try {
      const response = await api.get('/api/model/metrics/predict', {
        params: {
          source: device.source,
          metric_type: device.device_type,
          horizon_minutes: 30,
          step_minutes: 5,
        },
      })
      const predictions = response?.data?.predictions || []
      if (!predictions.length) {
        return buildLocalForecastFallback(actualData)
      }
      return predictions
    } catch (err) {
      console.warn('Short forecast API failed, using local fallback:', err?.message || err)
      return buildLocalForecastFallback(actualData)
    }
  }

  const fetchDeviceHistoryData = async (device, minutes = 120) => {
    if (historyEndpointSupportedRef.current) {
      try {
        const response = await api.get('/api/metrics/history', {
          params: {
            metric_type: device.device_type,
            source: device.source,
            minutes
          }
        })
        return response.data?.data || []
      } catch (err) {
        if (err?.response?.status === 404) {
          historyEndpointSupportedRef.current = false
        } else {
          throw err
        }
      }
    }

    const latestRes = await api.get('/api/metrics/latest', {
      params: { source: device.source }
    })
    const latestData = latestRes?.data || {}
    const byTypeMap = {
      temperature: latestData.latest_temperature,
      humidity: latestData.latest_humidity,
      soil_moisture: latestData.latest_soil_moisture,
      light_intensity: latestData.latest_light_intensity,
      pressure: latestData.latest_pressure,
    }
    const value = byTypeMap[device.device_type]
    if (value === null || value === undefined) return []

    return [{
      value,
      timestamp: latestData.timestamp || new Date().toISOString(),
      source: device.source,
      metric_type: device.device_type,
    }]
  }

  // Fetch chart data for selected device (past 2 hours = 120 minutes)
  const handleOpenChart = async (device) => {
    setSelectedDeviceForChart(device)
    setShowChartModal(true)
    setChartLoading(true)
    try {
      const rawData = await fetchDeviceHistoryData(device, 120)
      
      // Aggregate data by minute (1 point per minute)
      const formattedData = aggregateDataByMinute(rawData)
      
      // Calculate statistics from original data (not aggregated)
      if (rawData && rawData.length > 0) {
        const values = rawData.map(d => getMetricValue(d))
        const average = values.reduce((a, b) => a + b, 0) / values.length
        const min = Math.min(...values)
        const max = Math.max(...values)
        
        setChartStats({
          average: parseFloat(average.toFixed(2)),
          min: parseFloat(min.toFixed(2)),
          max: parseFloat(max.toFixed(2))
        })
      }
      
      const forecastPredictions = await fetchShortForecast(device, formattedData)
      setShortForecast(forecastPredictions)
      setChartData(mergeShortForecast(formattedData, forecastPredictions))
      setChartLastUpdated(new Date())
    } catch (err) {
      console.error('Failed to fetch chart data:', err)
      setChartData([])
      setShortForecast([])
      setChartStats({ average: 0, min: 0, max: 0 })
    } finally {
      setChartLoading(false)
    }
  }

  // Auto-refresh chart every 1 minute when modal is open
  useEffect(() => {
    if (!showChartModal || !selectedDeviceForChart) return

    const refreshChartData = async () => {
      try {
        if (isDev) console.log('Refreshing chart data for device:', selectedDeviceForChart.device_type)
        const rawData = await fetchDeviceHistoryData(selectedDeviceForChart, 120)
        
        // Aggregate data by minute (1 point per minute)
        const formattedData = aggregateDataByMinute(rawData)
        
        // Calculate statistics from original data (not aggregated)
        if (rawData && rawData.length > 0) {
          const values = rawData.map(d => getMetricValue(d))
          const average = values.reduce((a, b) => a + b, 0) / values.length
          const min = Math.min(...values)
          const max = Math.max(...values)
          
          setChartStats({
            average: parseFloat(average.toFixed(2)),
            min: parseFloat(min.toFixed(2)),
            max: parseFloat(max.toFixed(2))
          })
        }
        
        const forecastPredictions = await fetchShortForecast(selectedDeviceForChart, formattedData)
        setShortForecast(forecastPredictions)
        setChartData(mergeShortForecast(formattedData, forecastPredictions))
        setChartLastUpdated(new Date())
        if (isDev) console.log('Chart updated at (VN):', formatVNTime(new Date(), true))
      } catch (err) {
        console.error('Failed to refresh chart data:', err)
      }
    }

    // Refresh immediately when modal opens
    refreshChartData()
    
    // Then refresh every 1 minute (60000 ms)
    const interval = setInterval(refreshChartData, 60000)
    
    return () => clearInterval(interval)
  }, [showChartModal, selectedDeviceForChart])

  // Handle adding device via AddDeviceModal (for users)
  const handleAddDevice = async (deviceData) => {
    try {
      setAddingDevice(true)
      await createIoTDevice(deviceData)
      setShowAddDeviceModal(false)
    } catch (err) {
      console.error('Failed to add device:', err)
      notify('Error: ' + (err.response?.data?.detail || err.message))
    } finally {
      setAddingDevice(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      setLoading(true)
      const minRaw = String(formData.min_threshold ?? '').trim()
      const maxRaw = String(formData.max_threshold ?? '').trim()
      const hasMin = minRaw !== ''
      const hasMax = maxRaw !== ''
      if (hasMin !== hasMax) {
        notify('Please enter both Min and Max thresholds, or leave both empty')
        setLoading(false)
        return
      }
      const minVal = hasMin ? Number(minRaw) : null
      const maxVal = hasMax ? Number(maxRaw) : null
      if (hasMin && (Number.isNaN(minVal) || Number.isNaN(maxVal) || minVal >= maxVal)) {
        notify('Invalid threshold range')
        setLoading(false)
        return
      }
      const payload = {
        ...formData,
        metric_type: formData.device_type,
        min_threshold: minVal,
        max_threshold: maxVal,
        alert_enabled: hasMin && hasMax,
      }
      
      if (editingId) {
        await updateIoTDevice(editingId, payload)
        setEditingId(null)
      } else {
        await createIoTDevice(payload)
      }
      
      setFormData({
        name: '',
        device_type: 'temperature',
        source: '',
        unit: '°C',
        location: '',
        environment_type: 'indoor',
        min_threshold: '',
        max_threshold: '',
        is_active: true
      })
      setShowCreateModal(false)
    } catch (err) {
      notify('Error: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (deviceId) => {
    if (confirm('Delete this IoT device?')) {
      try {
        await deleteIoTDevice(deviceId)
      } catch (err) {
        notify('Error: ' + err.message)
      }
    }
  }

  // Toggle device active/inactive status (for admin - Device model)
  const toggleDeviceActive = async (deviceId) => {
    try {
      setLoading(true)
      const response = await api.put(`/api/admin/devices/${deviceId}/toggle`)
      notify(response.data.message || `Device ${response.data.is_active ? 'enabled' : 'disabled'} successfully`)
      
      // Refresh admin devices list
      if (isAdmin && allIoTDevices) {
        // Update the device in the list
        const updatedDevices = allIoTDevices.map(d => 
          d.id === deviceId ? { ...d, is_active: response.data.is_active } : d
        )
        // Note: This is a limitation - we'd need context update here
        window.location.reload() // Force refresh for now
      }
    } catch (err) {
      console.error('Error toggling device:', err)
      notify('Error: ' + (err.response?.data?.detail || err.message))
    } finally {
      setLoading(false)
    }
  }

  // Toggle IoT device active/inactive (user's own devices)
  const toggleIoTDeviceActive = async (deviceId, currentStatus) => {
    try {
      setLoading(true)
      await updateIoTDevice(deviceId, { is_active: !currentStatus })
      notify(`Device ${!currentStatus ? 'enabled' : 'disabled'} successfully`)
      // Devices list will auto-update via context
    } catch (err) {
      console.error('Error toggling IoT device:', err)
      notify('Error: ' + (err.response?.data?.detail || err.message))
    } finally {
      setLoading(false)
    }
  }

  // Admin functions
  const disconnectIoTDevice = async (deviceId) => {
    try {
      await api.put(`/api/admin/iot-devices/${deviceId}/disconnect`)
      notify('Device disconnected successfully')
      // Refresh devices list
      window.location.reload()
    } catch (err) {
      notify('Error disconnecting device: ' + (err.response?.data?.detail || err.message))
    }
  }

  const reconnectIoTDevice = async (deviceId) => {
    try {
      await api.put(`/api/admin/iot-devices/${deviceId}/reconnect`)
      notify('Device reconnected successfully')
      // Refresh devices list
      window.location.reload()
    } catch (err) {
      notify('Error reconnecting device: ' + (err.response?.data?.detail || err.message))
    }
  }

  const adminDeleteIoTDevice = async (deviceId) => {
    if (confirm('Delete this IoT device? (Admin action)')) {
      try {
        await api.delete(`/api/admin/iot-devices/${deviceId}`)
        notify('Device deleted successfully')
        // Refresh devices list
        window.location.reload()
      } catch (err) {
        notify('Error deleting device: ' + (err.response?.data?.detail || err.message))
      }
    }
  }

  const startEdit = (device) => {
    setFormData({
      name: device.name,
      device_type: device.device_type,
      source: device.source,
      unit: getMetricUnit(device.device_type, device.unit),
      location: device.location || '',
      environment_type: device.environment_type || 'indoor',
      min_threshold: device.min_threshold ?? '',
      max_threshold: device.max_threshold ?? '',
      is_active: device.is_active !== false
    })
    setEditingId(device.id)
    setShowCreateModal(true)
  }

  const openAlertThresholdsModal = (device) => {
    setSelectedDeviceForAlert(device)
    setShowAlertThresholdsModal(true)
  }

  const openSensorContextModal = (device) => {
    const existingLocationQuery = device.location_query || ''
    setSelectedDeviceForContext(device)
    setSensorContextForm({
      environment_type: device.environment_type || 'indoor',
      location_query: existingLocationQuery,
      task_description: device.task_description || '',
      priority_level: device.priority_level || 'medium',
      action_hint: device.action_hint || '',
    })
    setContextLocationCheck({
      checked: false,
      success: false,
      message: '',
    })
    setShowSensorContextModal(true)
  }

  const closeSensorContextModal = () => {
    setShowSensorContextModal(false)
    setSelectedDeviceForContext(null)
  }

  const wifiErrorMessage = (err) => {
    const detail = err.response?.data?.detail || err.response?.data?.error || err.message
    if (err.response?.status === 502 || /iot backend/i.test(String(detail))) {
      return 'IoT backend chưa chạy hoặc IOT_BACKEND_URL sai'
    }
    if (err.response?.status === 404 || String(detail).toLowerCase() === 'not found') {
      return 'Không tìm thấy API WiFi scan. Kiểm tra backend chính và iot_backend.'
    }
    return detail
  }

  const loadWifiScanResult = async (sensorId, { notifyIfEmpty = false } = {}) => {
    const encodedSource = encodeURIComponent(sensorId)
    const url = `/api/devices/${encodedSource}/wifi-list`
    console.log(`[WIFI UI] GET ${url}`)
    const response = await api.get(url)
    console.log('[WIFI UI] response=', response?.data)
    const networks = Array.isArray(response?.data?.networks) ? response.data.networks : []
    console.log(`[WIFI UI] networks count=${networks.length}`)
    setWifiNetworks(networks)
    setWifiReceivedAt(response?.data?.received_at || response?.data?.timestamp || '')
    if (notifyIfEmpty && networks.length === 0) {
      notify('ESP32 chưa trả danh sách WiFi, thử quét lại')
    }
    return response?.data || {}
  }

  const loadWifiConnectionStatus = async (sensorId) => {
    const encodedSource = encodeURIComponent(sensorId)
    const url = `/api/devices/${encodedSource}/wifi-status`
    console.log(`[WIFI UI] GET ${url}`)
    const response = await api.get(url)
    console.log('[WIFI UI] wifi-status response=', response?.data)
    setWifiStatus(response?.data || null)
    return response?.data || {}
  }

  const requestWifiScan = async (sensorId) => {
    const encodedSource = encodeURIComponent(sensorId)
    const url = `/api/devices/${encodedSource}/scan-wifi`
    console.log(`[WIFI UI] scan device source=${sensorId}`)
    console.log(`[WIFI UI] POST ${url}`)
    const response = await api.post(url)
    console.log('[WIFI UI] response=', response?.data)
    return response
  }

  const waitForWifiScan = () => new Promise((resolve) => setTimeout(resolve, 3500))

  const openWifiModal = async (device) => {
    setSelectedDeviceForWifi(device)
    setWifiForm({ ssid: '', password: '' })
    setWifiNetworks([])
    setWifiReceivedAt('')
    setWifiStatus(null)
    setShowWifiModal(true)
    setWifiLoading(true)
    try {
      await requestWifiScan(device.source)
      await waitForWifiScan()
      await Promise.all([
        loadWifiScanResult(device.source, { notifyIfEmpty: true }),
        loadWifiConnectionStatus(device.source),
      ])
    } catch (err) {
      notify('Scan WiFi failed: ' + wifiErrorMessage(err))
    } finally {
      setWifiLoading(false)
    }
  }

  const closeWifiModal = () => {
    setShowWifiModal(false)
    setSelectedDeviceForWifi(null)
    setWifiNetworks([])
    setWifiReceivedAt('')
    setWifiStatus(null)
    setWifiForm({ ssid: '', password: '' })
  }

  const handleRefreshWifiList = async () => {
    if (!selectedDeviceForWifi || wifiLoading) return
    setWifiLoading(true)
    try {
      await requestWifiScan(selectedDeviceForWifi.source)
      await waitForWifiScan()
      await Promise.all([
        loadWifiScanResult(selectedDeviceForWifi.source, { notifyIfEmpty: true }),
        loadWifiConnectionStatus(selectedDeviceForWifi.source),
      ])
    } catch (err) {
      notify('Scan WiFi failed: ' + wifiErrorMessage(err))
    } finally {
      setWifiLoading(false)
    }
  }

  const handleSubmitWifiConfig = async () => {
    if (!selectedDeviceForWifi) return
    const ssid = wifiForm.ssid.trim()
    if (!ssid) {
      notify('Vui lòng chọn hoặc nhập SSID')
      return
    }
    setWifiSubmitting(true)
    try {
      const encodedSource = encodeURIComponent(selectedDeviceForWifi.source)
      const url = `/api/devices/${encodedSource}/wifi-config`
      console.log(`[WIFI UI] POST ${url}`)
      const response = await api.post(url, {
        ssid,
        password: wifiForm.password || '',
      })
      console.log('[WIFI UI] wifi-config response=', response?.data)
      notify('Đã gửi cấu hình WiFi. ESP32 sẽ lưu và tự khởi động lại.')
      closeWifiModal()
    } catch (err) {
      notify('Đổi WiFi thất bại: ' + wifiErrorMessage(err))
    } finally {
      setWifiSubmitting(false)
    }
  }

  const getCommandLoadingKey = (device, actuator, enabled) => `${device.id}:${actuator}:${enabled ? 'on' : 'off'}`

  const isCommandLoading = (device, actuator, enabled) => {
    return !!deviceCommandLoading[getCommandLoadingKey(device, actuator, enabled)]
  }

  const sendDeviceTestCommand = async (device, actuator, enabled) => {
    const payload = { auto: false }
    if (actuator === 'fan') {
      payload.fan = enabled
    } else if (actuator === 'fog') {
      payload.fog = enabled
    } else {
      return
    }

    const loadingKey = getCommandLoadingKey(device, actuator, enabled)
    setDeviceCommandLoading((prev) => ({ ...prev, [loadingKey]: true }))
    try {
      const encodedSource = encodeURIComponent(device.source)
      await api.post(`/api/devices/${encodedSource}/manual-command`, payload)
      const actionLabel = actuator === 'fan' ? 'quạt' : 'phun sương'
      notify(`${enabled ? 'Đã bật' : 'Đã tắt'} ${actionLabel} cho ${device.name}`)
    } catch (err) {
      const actionLabel = actuator === 'fan' ? 'quạt' : 'phun sương'
      notify(`Điều khiển ${actionLabel} thất bại: ${wifiErrorMessage(err)}`)
    } finally {
      setDeviceCommandLoading((prev) => {
        const next = { ...prev }
        delete next[loadingKey]
        return next
      })
    }
  }

  useEffect(() => {
    if (!showWifiModal || !selectedDeviceForWifi) return
    const interval = setInterval(() => {
      Promise.allSettled([
        loadWifiScanResult(selectedDeviceForWifi.source),
        loadWifiConnectionStatus(selectedDeviceForWifi.source),
      ]).catch(() => {})
    }, 4000)
    return () => clearInterval(interval)
  }, [showWifiModal, selectedDeviceForWifi])

  const handleSensorContextChange = (e) => {
    const { name, value } = e.target
    setSensorContextForm((prev) => ({ ...prev, [name]: value }))
    if (name === 'environment_type' || name === 'location_query') {
      setContextLocationCheck({
        checked: false,
        success: false,
        message: '',
      })
    }
  }
  const isStandardProvinceLocation = (value) => VIETNAM_PROVINCES.includes((value || '').trim())

  const handleCheckContextLocation = async () => {
    const query = sensorContextForm.location_query.trim()
    if (!query) {
      setContextLocationCheck({
        checked: true,
        success: false,
        message: 'Vui lòng nhập khu vực ngoài trời trước khi kiểm tra.',
      })
      return
    }
    if (!isStandardProvinceLocation(query)) {
      setContextLocationCheck({
        checked: true,
        success: false,
        message: 'Vui lòng chọn đúng tỉnh/thành trong danh sách chuẩn hóa.',
      })
      return
    }

    try {
      setCheckingContextLocation(true)
      const response = await api.post('/api/iot-devices/geocode', { location_query: query })
      const data = response?.data || {}
      if (typeof data.latitude !== 'number' || typeof data.longitude !== 'number') {
        setContextLocationCheck({
          checked: true,
          success: false,
          message: 'Không nhận diện được tọa độ. Bạn thử địa danh chi tiết hơn nhé.',
        })
        return
      }
      setContextLocationCheck({
        checked: true,
        success: true,
        message: `Đã nhận diện: ${data.name || query} (${data.latitude.toFixed(4)}, ${data.longitude.toFixed(4)})`,
      })
    } catch (err) {
      setContextLocationCheck({
        checked: true,
        success: false,
        message: err.response?.data?.detail || 'Không thể kiểm tra vị trí lúc này.',
      })
    } finally {
      setCheckingContextLocation(false)
    }
  }

  const saveSensorContext = async () => {
    if (!selectedDeviceForContext) return
    if (sensorContextForm.environment_type === 'outdoor' && !sensorContextForm.location_query.trim()) {
      notify('Vui lòng nhập khu vực ngoài trời')
      return
    }
    if (sensorContextForm.environment_type === 'outdoor' && !isStandardProvinceLocation(sensorContextForm.location_query)) {
      notify('Vui lòng chọn tỉnh/thành chuẩn hóa trong danh sách')
      return
    }
    if (sensorContextForm.environment_type === 'outdoor' && !contextLocationCheck.success) {
      notify('Vui lòng bấm "Kiểm tra vị trí" và xác nhận thành công trước khi lưu')
      return
    }

    try {
      setSavingSensorContext(true)
      await updateIoTDevice(selectedDeviceForContext.id, {
        environment_type: sensorContextForm.environment_type,
        location_query: sensorContextForm.environment_type === 'outdoor' ? sensorContextForm.location_query.trim() : null,
        task_description: sensorContextForm.task_description.trim() || null,
        priority_level: sensorContextForm.priority_level || null,
        action_hint: sensorContextForm.action_hint.trim() || null,
      })
      notify('Đã cập nhật ngữ cảnh AI cho sensor')
      closeSensorContextModal()
    } catch (err) {
      notify('Lưu thất bại: ' + (err.response?.data?.detail || err.message))
    } finally {
      setSavingSensorContext(false)
    }
  }

  const handleSaveAlertThresholds = async (thresholdData) => {
    if (!selectedDeviceForAlert) return

    try {
      setSavingAlerts(true)
      if (isDev) console.log('API URL:', api.defaults.baseURL)
      if (isDev) console.log('Auth Header:', api.defaults.headers.common['Authorization'])
      if (isDev) console.log('Sending threshold data:', thresholdData)
      
      const response = await api.put(`/api/iot-devices/${selectedDeviceForAlert.id}/alert-thresholds`, thresholdData)
      if (isDev) console.log('Response received:', response.data)
      if (response.data?.threshold_config_published === false) {
        notify('⚠️ Đã lưu threshold vào DB nhưng MQTT chưa sẵn sàng, ESP32 chưa nhận config')
      } else {
        notify('✅ ' + response.data.message + ' và đã gửi xuống ESP32')
      }
      setShowAlertThresholdsModal(false)
      
      // Refresh ALL devices to get updated threshold values
      if (isDev) console.log('Refreshing device list...')
      if (isAdmin) {
        if (isDev) console.log('Admin user - fetching all devices')
        await fetchAllIoTDevices()
      } else {
        if (isDev) console.log('Regular user - fetching my devices')
        await fetchIoTDevices()
      }
      if (isDev) console.log('Device list refreshed successfully')
    } catch (err) {
      console.error('Full error object:', err)
      console.error('Error message:', err.message)
      console.error('Error config:', err.config)
      console.error('Error response:', err.response)
      notify('Error: ' + (err.response?.data?.detail || err.message || 'Unknown error'))
    } finally {
      setSavingAlerts(false)
    }
  }

  const loadTargets = async () => {
    const res = await api.get('/api/auth/notifications/targets')
    setNotificationTargets(res.data?.targets || [])
  }

  const addTelegramTarget = async () => {
    try {
      setSettingsLoading(true)
      if (!newTelegramChatId.trim()) {
        notify('Please enter Telegram Chat ID')
        return
      }
      await api.post('/api/auth/notifications/targets', {
        target_type: 'telegram',
        target_value: newTelegramChatId.trim()
      })
      setNewTelegramChatId('')
      await loadTargets()
      notify('Telegram target added')
    } catch (err) {
      notify('Telegram error: ' + (err.response?.data?.detail || err.message))
    } finally {
      setSettingsLoading(false)
    }
  }

  const addEmailTarget = async () => {
    try {
      setSettingsLoading(true)
      if (!newEmail.trim()) {
        notify('Please enter email address')
        return
      }
      await api.post('/api/auth/notifications/targets', {
        target_type: 'email',
        target_value: newEmail.trim()
      })
      setNewEmail('')
      await loadTargets()
      notify('Email target added')
    } catch (err) {
      notify('Email error: ' + (err.response?.data?.detail || err.message))
    } finally {
      setSettingsLoading(false)
    }
  }

  const toggleTarget = async (targetId, enabled) => {
    try {
      setSettingsLoading(true)
      await api.patch(`/api/auth/notifications/targets/${targetId}`, { is_enabled: enabled })
      await loadTargets()
    } catch (err) {
      notify('Update target failed: ' + (err.response?.data?.detail || err.message))
    } finally {
      setSettingsLoading(false)
    }
  }

  const deleteTarget = async (targetId) => {
    try {
      setSettingsLoading(true)
      await api.delete(`/api/auth/notifications/targets/${targetId}`)
      await loadTargets()
    } catch (err) {
      notify('Delete target failed: ' + (err.response?.data?.detail || err.message))
    } finally {
      setSettingsLoading(false)
    }
  }

  const testEmailTarget = async (email) => {
    try {
      setSettingsLoading(true)
      const res = await api.post('/api/notifications/test-email', { email })
      notify(res.data?.message || 'Test email sent')
    } catch (err) {
      const stage = err.response?.data?.stage
      const error = err.response?.data?.error || err.response?.data?.detail || err.message
      notify('Test email failed: ' + (stage ? `[${stage}] ` : '') + error)
    } finally {
      setSettingsLoading(false)
    }
  }

  const getDeviceTypeBadgeClass = (type) => {
    const styles = {
      temperature: 'text-neon-orange bg-neon-orange/20',
      humidity: 'text-neon-cyan bg-neon-cyan/20',
      soil_moisture: 'text-neon-green bg-neon-green/20',
      light_intensity: 'text-neon-yellow bg-neon-yellow/20',
      pressure: 'text-neon-purple bg-neon-purple/20',
    }
    return styles[type] || 'text-neon-cyan bg-neon-cyan/20'
  }

  const getDeviceTypeBadgeLabel = (type) => {
    const labels = {
      temperature: 'temperature',
      humidity: 'humidity',
    }
    return labels[type] || type
  }

  const getMetricUnit = (type, unitOverride) => {
    const units = {
      temperature: '°C',
      humidity: '%',
      soil_moisture: '%',
      light_intensity: 'lux',
      pressure: 'hPa'
    }
    return unitOverride || units[type] || ''
  }

  const getLatestValue = (deviceId) => {
    const metric = latestMetrics[deviceId]
    if (!metric || metric.value === null || metric.value === undefined) {
      return 'N/A'
    }
    return typeof metric.value === 'number' ? metric.value.toFixed(2) : metric.value
  }

  const getLatestUpdatedTime = (deviceId) => {
    const timestamp = latestMetrics[deviceId]?.timestamp
    if (!timestamp) return 'N/A'
    return formatVNTime(timestamp, true)
  }

  // Check if alert is triggered for a device
  const checkAlertTriggered = (device) => {
    const latestValue = latestMetrics[device.id]?.value
    
    // If no value, no alert
    if (latestValue === null || latestValue === undefined) return { triggered: false, status: null }

    const minThreshold = device.min_threshold
    const maxThreshold = device.max_threshold
    const configured = (minThreshold !== null && minThreshold !== undefined) && (maxThreshold !== null && maxThreshold !== undefined)

    if (!configured) return { configured: false, triggered: false, status: null }

    if (isDev) {
      console.log(`[checkAlertTriggered] Device: ${device.name}, latestValue: ${latestValue}`)
      console.log(`[checkAlertTriggered] Thresholds - Min: ${minThreshold}, Max: ${maxThreshold}`)
    }

    // Check upper threshold (exceeds high limit)
    if (latestValue > maxThreshold) {
      if (isDev) console.log(`[checkAlertTriggered] ALERT triggered (Upper) for ${device.name}: ${latestValue} > ${maxThreshold}`)
      return { configured: true, triggered: true, status: 'upper', threshold: maxThreshold }
    }

    // Check lower threshold (falls below low limit)
    if (latestValue < minThreshold) {
      if (isDev) console.log(`[checkAlertTriggered] ALERT triggered (Lower) for ${device.name}: ${latestValue} < ${minThreshold}`)
      return { configured: true, triggered: true, status: 'lower', threshold: minThreshold }
    }

    return { configured: true, triggered: false, status: null }
  }

  return (
    <div className="p-8 space-y-8">
      {/* Admin View - User Device Count Summary */}
      {isAdmin ? (
        <>
          <div>
            <h1 className="text-4xl font-bold text-white mb-2">IoT Devices Overview</h1>
            <p className="text-gray-400">Users and their device counts (Admin view - no device details)</p>
          </div>

          {/* User Device Count Table */}
          <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
            <table className="w-full">
              <thead className="bg-slate-900 border-b border-slate-700">
                <tr>
                  <th className="px-6 py-3 text-left text-cyan-400 font-semibold">User</th>
                  <th className="px-6 py-3 text-left text-cyan-400 font-semibold">Email</th>
                  <th className="px-6 py-3 text-left text-cyan-400 font-semibold">Device Count</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {userOnlySummary.map((item) => (
                  <tr key={item.user_id} className="hover:bg-slate-700/50 transition">
                    <td className="px-6 py-3 text-white font-medium">{item.username}</td>
                    <td className="px-6 py-3 text-gray-400">{item.email}</td>
                    <td className="px-6 py-3">
                      <span className="bg-cyan-600/20 text-cyan-400 px-3 py-1 rounded-full text-sm font-medium">
                        {item.device_count} device{item.device_count !== 1 ? 's' : ''}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {userOnlySummary.length === 0 && (
              <div className="text-center py-8 text-gray-400">No users with devices</div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 bg-slate-700/50 rounded-lg">
              <p className="text-gray-300 text-sm">Total Devices</p>
              <p className="text-cyan-400 font-bold text-2xl">{adminSummary?.total_devices || 0}</p>
            </div>
            <div className="p-4 bg-slate-700/50 rounded-lg">
              <p className="text-gray-300 text-sm">Total Users</p>
              <p className="text-cyan-400 font-bold text-2xl">{userOnlySummary.length}</p>
            </div>
          </div>
        </>
      ) : (
        <>
          {/* User View - Device Details and Add Button */}
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-4xl font-bold text-white mb-2">IoT Devices</h1>
              <p className="text-gray-400">Manage your IoT sensors and devices</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowNotificationSettings(!showNotificationSettings)}
                className="flex items-center gap-2 bg-indigo-500/20 text-indigo-300 border border-indigo-400/40 hover:bg-indigo-500/30 px-4 py-2 rounded-lg transition-all"
              >
                <Settings className="w-4 h-4" />
                Setting
              </button>
              <button
                onClick={() => setShowAddDeviceModal(true)}
                className="flex items-center gap-2 bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/40 hover:border-neon-cyan px-4 py-2 rounded-lg transition-all"
              >
                <Plus className="w-5 h-5" />
                Add Device
              </button>
            </div>
          </div>

          {showNotificationSettings && (
            <div className="rounded-xl border border-indigo-400/30 bg-dark-800 p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Notification Settings</h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-lg border border-cyan-400/30 bg-dark-900/60 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-cyan-300 font-semibold">Telegram</p>
                    <button
                      onClick={() => setShowTelegramGuide((prev) => !prev)}
                      className="text-xs px-3 py-1 rounded border border-cyan-400/40 text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 transition-all"
                    >
                      {showTelegramGuide ? 'Ẩn hướng dẫn' : 'Hướng dẫn tìm Chat ID'}
                    </button>
                  </div>
                  {showTelegramGuide && (
                    <div className="mb-3 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3 text-sm text-cyan-100">
                      <p className="font-semibold mb-2">Hướng dẫn tìm Chat ID và bắt đầu:</p>
                      <p className="mb-1">Bước 1: Mở Telegram và tìm bot có tên <span className="font-mono text-cyan-300">@metrics_pulse_test_bot</span>, sau đó nhấn bắt đầu.</p>
                      <p className="mb-1">Bước 2: Tìm bot có tên <span className="font-mono text-cyan-300">@Getmyid_bot</span> và nhấn bắt đầu.</p>
                      <p>Bước 3: Sao chép Chat ID mà bot gửi lại cho bạn.</p>
                    </div>
                  )}
                  <input
                    type="text"
                    value={newTelegramChatId}
                    onChange={(e) => setNewTelegramChatId(e.target.value)}
                    placeholder="Enter Telegram Chat ID"
                    className="w-full bg-dark-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:border-cyan-400 outline-none mb-3"
                  />
                  <button
                    onClick={addTelegramTarget}
                    disabled={settingsLoading}
                    className="w-full px-3 py-2 bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 rounded-lg hover:bg-cyan-500/30 disabled:opacity-50 mb-3"
                  >
                    Add Telegram Chat ID
                  </button>
                  <div className="space-y-2">
                    {notificationTargets.filter(t => t.target_type === 'telegram').map(t => (
                      <div key={t.id} className="flex items-center justify-between bg-dark-800 rounded px-3 py-2">
                        <span className="text-sm text-gray-200">{t.target_value}</span>
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-gray-300 flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={!!t.is_enabled}
                              onChange={(e) => toggleTarget(t.id, e.target.checked)}
                            />
                            Enable
                          </label>
                          <button onClick={() => deleteTarget(t.id)} className="text-red-400 text-xs">Delete</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-emerald-400/30 bg-dark-900/60 p-4">
                  <p className="text-emerald-300 font-semibold mb-3">Email</p>
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="Enter email for alerts"
                    className="w-full bg-dark-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:border-emerald-400 outline-none mb-3"
                  />
                  <button
                    onClick={addEmailTarget}
                    disabled={settingsLoading}
                    className="w-full px-3 py-2 bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 rounded-lg hover:bg-emerald-500/30 disabled:opacity-50 mb-3"
                  >
                    Add Email
                  </button>
                  <div className="space-y-2">
                    {notificationTargets.filter(t => t.target_type === 'email').map(t => (
                      <div key={t.id} className="flex items-center justify-between bg-dark-800 rounded px-3 py-2">
                        <span className="text-sm text-gray-200">{t.target_value}</span>
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-gray-300 flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={!!t.is_enabled}
                              onChange={(e) => toggleTarget(t.id, e.target.checked)}
                            />
                            Enable
                          </label>
                          <button onClick={() => testEmailTarget(t.target_value)} className="text-cyan-300 text-xs">Test</button>
                          <button onClick={() => deleteTarget(t.id)} className="text-red-400 text-xs">Delete</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Devices Grid - Only for Users */}
          {displayDevices.length === 0 ? (
            <div className="text-center py-16">
              <Radio className="w-16 h-16 text-gray-600 mx-auto mb-4 opacity-50" />
              <h3 className="text-xl font-semibold text-white mb-2">No IoT Devices</h3>
              <p className="text-gray-400 mb-6">Create your first IoT device to start monitoring</p>
              <button
                onClick={() => setShowAddDeviceModal(true)}
                className="inline-flex items-center gap-2 bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/40 px-6 py-3 rounded-lg hover:border-neon-cyan transition-all"
              >
                <Plus className="w-5 h-5" />
                Create First Device
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {displayDevices.map(device => {
                const alertStatus = checkAlertTriggered(device)
                const minThreshold = device.min_threshold
                const maxThreshold = device.max_threshold
                const thresholdsConfigured = (minThreshold !== null && minThreshold !== undefined) && (maxThreshold !== null && maxThreshold !== undefined)
                const cardBorderColor = alertStatus.triggered
                  ? 'border-red-500/60 bg-red-950/20'
                  : 'border-neon-cyan/20 bg-dark-800'
                
                return (
                <div
                  key={device.id}
                  onClick={() => handleOpenChart(device)}
                  className={`rounded-xl p-6 hover:border-neon-cyan/60 hover:cursor-pointer transition-all hover:bg-dark-700 ${cardBorderColor}`}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-bold text-white mb-1">{device.name}</h3>
                      <p className="text-xs text-gray-500 font-mono">Source: {device.source}</p>
                      {deviceOwners[device.id] && (
                        <p className="text-xs text-gray-500">Created by: {deviceOwners[device.id]}</p>
                      )}
                    </div>
                    <span className={`text-xs px-2 py-1 rounded ${getDeviceTypeBadgeClass(device.device_type)}`}>
                      {getDeviceTypeBadgeLabel(device.device_type)}
                    </span>
                  </div>

                  {device.location && (
                    <div className="flex items-center gap-2 text-sm text-gray-400 mb-4">
                      <Home className="w-4 h-4" />
                      {device.location}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 mb-3">
                    <span className="text-xs px-2 py-1 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-300">
                      {device.environment_type === 'outdoor' ? 'Ngoài trời' : 'Trong nhà'}
                    </span>
                    {device.environment_type === 'outdoor' && device.location_query && (
                      <span className="text-xs px-2 py-1 rounded border border-purple-500/40 bg-purple-500/10 text-purple-300">
                        {device.location_query}
                      </span>
                    )}
                  </div>

                  {/* Real-time Metric Display - Integrated with Thresholds */}
                  <div className={`rounded-lg p-4 mb-4 transition-all ${
                    alertStatus.triggered
                      ? 'bg-red-950/40 border-2 border-red-500/60'
                      : 'bg-dark-900/50 border border-neon-cyan/20'
                  }`}>
                    {/* Sensor Value + Status */}
                    <div className="flex items-end justify-between mb-3">
                      <div>
                        <p className="text-xs text-gray-400 mb-1">Real-time Value</p>
                        <div className="flex items-baseline gap-2">
                          <span className={`text-3xl font-bold ${
                            alertStatus.triggered
                              ? 'text-red-400'
                              : 'text-neon-cyan'
                          }`}>
                            {getLatestValue(device.id)}
                          </span>
                          <span className="text-sm text-gray-400">
                            {getMetricUnit(device.device_type, device.unit)}
                          </span>
                        </div>
                        {SHOW_DEVICE_UPDATED_TIME && (
                          <p className="text-[11px] text-gray-500 mt-1">
                            Updated: {getLatestUpdatedTime(device.id)}
                          </p>
                        )}
                      </div>
                      {thresholdsConfigured && (
                        alertStatus.triggered ? (
                          <div className="flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold bg-red-500/30 text-red-400">
                            🚨 OUT OF RANGE
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold bg-emerald-500/20 text-emerald-300">
                            ✅ NORMAL
                          </div>
                        )
                      )}
                    </div>

                    {/* Alert Thresholds - Inline */}
                    {thresholdsConfigured && (
                      <div className="grid grid-cols-2 gap-2 pt-3 border-t border-gray-700/50">
                        <div className={`rounded px-2 py-2 border text-center ${
                          alertStatus.triggered && alertStatus.status === 'lower'
                            ? 'bg-red-500/20 border-red-500/60'
                            : 'bg-blue-500/10 border-blue-500/30'
                        }`}>
                          <p className="text-xs text-blue-400/70 font-semibold">⬇️ Min</p>
                          <p className="text-sm font-mono text-blue-300">{
                            typeof minThreshold === 'number'
                              ? minThreshold.toFixed(1)
                              : minThreshold
                          }</p>
                        </div>
                        <div className={`rounded px-2 py-2 border text-center ${
                          alertStatus.triggered && alertStatus.status === 'upper'
                            ? 'bg-red-500/20 border-red-500/60'
                            : 'bg-green-500/10 border-green-500/30'
                        }`}>
                          <p className="text-xs text-green-400/70 font-semibold">⬆️ Max</p>
                          <p className="text-sm font-mono text-green-300">{
                            typeof maxThreshold === 'number'
                              ? maxThreshold.toFixed(1)
                              : maxThreshold
                          }</p>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 mb-4">
                    <span className={`w-2 h-2 ${device.is_active ? 'bg-green-500' : 'bg-red-500'} rounded-full`}></span>
                    <span className={`text-xs ${device.is_active ? 'text-green-400' : 'text-red-400'}`}>
                      {device.is_active ? 'Active' : 'Inactive'}
                    </span>
                    {isAdmin && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleDeviceActive(device.id)
                        }}
                        className="ml-auto flex items-center gap-1 px-2 py-1 bg-yellow-500/20 text-yellow-400 rounded hover:bg-yellow-500/30 transition-all text-xs"
                        title={device.is_active ? 'Disable metric generation' : 'Enable metric generation'}
                      >
                        {device.is_active ? <PowerOff className="w-3 h-3" /> : <Power className="w-3 h-3" />}
                        {device.is_active ? 'Disable' : 'Enable'}
                      </button>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    {/* User buttons */}
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setOpenSettingsMenuId((prev) => (prev === device.id ? null : device.id))
                          }}
                          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-cyan-500/20 text-cyan-300 rounded hover:bg-cyan-500/30 transition-all text-sm border border-cyan-400/30"
                          title="Open sensor settings"
                        >
                          <Settings className="w-4 h-4" />
                          Setting
                        </button>

                        {openSettingsMenuId === device.id && (
                          <div
                            className="absolute left-0 right-0 mt-2 bg-dark-900/95 border border-cyan-400/30 rounded-lg shadow-xl backdrop-blur-sm z-20 p-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={() => {
                                openAlertThresholdsModal(device)
                                setOpenSettingsMenuId(null)
                              }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-left text-amber-300 hover:bg-amber-500/20 rounded-md transition-all text-sm"
                              title="Configure alert thresholds"
                            >
                              <AlertCircle className="w-4 h-4" />
                              Alerts
                            </button>
                            <button
                              onClick={() => {
                                startEdit(device)
                                setOpenSettingsMenuId(null)
                              }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-left text-blue-300 hover:bg-blue-500/20 rounded-md transition-all text-sm"
                            >
                              <Edit2 className="w-4 h-4" />
                              Edit
                            </button>
                            <button
                              onClick={() => {
                                openWifiModal(device)
                                setOpenSettingsMenuId(null)
                              }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-left text-sky-300 hover:bg-sky-500/20 rounded-md transition-all text-sm"
                              title="Quét và cấu hình WiFi cho ESP32"
                            >
                              <Wifi className="w-4 h-4" />
                              WiFi
                            </button>
                            <button
                              onClick={() => {
                                openSensorContextModal(device)
                                setOpenSettingsMenuId(null)
                              }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-left text-cyan-300 hover:bg-cyan-500/20 rounded-md transition-all text-sm"
                              title="Cấu hình ngữ cảnh AI cho sensor"
                            >
                              <Settings className="w-4 h-4" />
                              AI Context
                            </button>
                            {(device.device_type === 'temperature' || device.device_type === 'humidity') && (
                              <div className="mt-1 border-t border-cyan-400/10 pt-2 px-2 pb-1">
                                <p className="text-[11px] uppercase tracking-wide text-orange-300/70 mb-2">
                                  Test thiết bị
                                </p>
                                <div className="grid grid-cols-2 gap-2">
                                  {device.device_type === 'temperature' ? (
                                    <>
                                      <button
                                        onClick={() => {
                                          sendDeviceTestCommand(device, 'fan', true)
                                          setOpenSettingsMenuId(null)
                                        }}
                                        disabled={isCommandLoading(device, 'fan', true) || isCommandLoading(device, 'fan', false)}
                                        className="px-3 py-2 bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 rounded-md hover:bg-emerald-500/30 transition-all disabled:opacity-50 text-xs"
                                      >
                                        {isCommandLoading(device, 'fan', true) ? 'Đang bật...' : 'Bật quạt'}
                                      </button>
                                      <button
                                        onClick={() => {
                                          sendDeviceTestCommand(device, 'fan', false)
                                          setOpenSettingsMenuId(null)
                                        }}
                                        disabled={isCommandLoading(device, 'fan', true) || isCommandLoading(device, 'fan', false)}
                                        className="px-3 py-2 bg-rose-500/20 text-rose-300 border border-rose-400/30 rounded-md hover:bg-rose-500/30 transition-all disabled:opacity-50 text-xs"
                                      >
                                        {isCommandLoading(device, 'fan', false) ? 'Đang tắt...' : 'Tắt quạt'}
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <button
                                        onClick={() => {
                                          sendDeviceTestCommand(device, 'fog', true)
                                          setOpenSettingsMenuId(null)
                                        }}
                                        disabled={isCommandLoading(device, 'fog', true) || isCommandLoading(device, 'fog', false)}
                                        className="px-3 py-2 bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 rounded-md hover:bg-emerald-500/30 transition-all disabled:opacity-50 text-xs"
                                      >
                                        {isCommandLoading(device, 'fog', true) ? 'Đang bật...' : 'Bật phun sương'}
                                      </button>
                                      <button
                                        onClick={() => {
                                          sendDeviceTestCommand(device, 'fog', false)
                                          setOpenSettingsMenuId(null)
                                        }}
                                        disabled={isCommandLoading(device, 'fog', true) || isCommandLoading(device, 'fog', false)}
                                        className="px-3 py-2 bg-rose-500/20 text-rose-300 border border-rose-400/30 rounded-md hover:bg-rose-500/30 transition-all disabled:opacity-50 text-xs"
                                      >
                                        {isCommandLoading(device, 'fog', false) ? 'Đang tắt...' : 'Tắt phun sương'}
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDelete(device.id)
                          setOpenSettingsMenuId(null)
                        }}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-all text-sm border border-red-400/30"
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-dark-800 border border-neon-cyan/20 rounded-xl p-8 max-w-md w-full mx-4">
            <h3 className="text-2xl font-bold text-white mb-6">
              {editingId ? 'Edit IoT Device' : 'Add New IoT Device'}
            </h3>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-2">Device Name</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  className="w-full bg-dark-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:border-neon-cyan outline-none"
                  placeholder="E.g., Room 1 Temperature"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">Metric Type</label>
                <select
                  value={formData.device_type}
                  onChange={(e) => {
                    const nextType = e.target.value
                    setFormData({
                      ...formData,
                      device_type: nextType,
                      unit: getMetricUnit(nextType)
                    })
                  }}
                  className="w-full bg-dark-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:border-neon-cyan outline-none"
                >
                  <option value="temperature">🌡️ Temperature</option>
                  <option value="humidity">💧 Humidity</option>
                </select>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">Unit</label>
                <input
                  type="text"
                  value={formData.unit}
                  onChange={(e) => setFormData({...formData, unit: e.target.value})}
                  className="w-full bg-dark-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:border-neon-cyan outline-none"
                  placeholder="°C or %"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">Source</label>
                <input
                  type="text"
                  required
                  value={formData.source}
                  onChange={(e) => setFormData({...formData, source: e.target.value})}
                  className="w-full bg-dark-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:border-neon-cyan outline-none font-mono"
                  placeholder="E.g., esp32_devkit_v1"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">Location (Optional)</label>
                <input
                  type="text"
                  value={formData.location}
                  onChange={(e) => setFormData({...formData, location: e.target.value})}
                  className="w-full bg-dark-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:border-neon-cyan outline-none"
                  placeholder="E.g., Living Room"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">Category</label>
                <select
                  value={formData.environment_type}
                  onChange={(e) => setFormData({...formData, environment_type: e.target.value})}
                  className="w-full bg-dark-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:border-neon-cyan outline-none"
                >
                  <option value="indoor">Trong nhà</option>
                  <option value="outdoor">Ngoài trời</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-400 mb-2">Min Threshold</label>
                  <input
                    type="number"
                    step="any"
                    value={formData.min_threshold}
                    onChange={(e) => setFormData({...formData, min_threshold: e.target.value})}
                    className="w-full bg-dark-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:border-neon-cyan outline-none"
                    placeholder="optional"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-2">Max Threshold</label>
                  <input
                    type="number"
                    step="any"
                    value={formData.max_threshold}
                    onChange={(e) => setFormData({...formData, max_threshold: e.target.value})}
                    className="w-full bg-dark-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:border-neon-cyan outline-none"
                    placeholder="optional"
                  />
                </div>
              </div>

              <label className="flex items-center gap-3 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={!!formData.is_active}
                  onChange={(e) => setFormData({...formData, is_active: e.target.checked})}
                  className="w-4 h-4"
                />
                Active
              </label>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false)
                    setEditingId(null)
                  }}
                  className="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 px-4 py-2 bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/40 rounded-lg hover:border-neon-cyan transition-all disabled:opacity-50"
                >
                  {loading ? 'Saving...' : editingId ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Chart Modal */}
      {showChartModal && selectedDeviceForChart && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-dark-800 border border-neon-cyan/20 rounded-xl p-8 max-w-4xl w-full mx-4">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-2xl font-bold text-white mb-1">
                  {selectedDeviceForChart.name}
                </h3>
                <p className="text-sm text-gray-400">
                  Last 2 hours of {selectedDeviceForChart.device_type} data
                </p>
                <p className="text-xs text-yellow-300 mt-1">
                  Includes 30-minute short forecast (5-minute steps)
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Forecast points: {shortForecast.length}
                </p>
                {deviceOwners[selectedDeviceForChart.id] && (
                  <p className="text-xs text-gray-500 mt-2">
                    Created by: {deviceOwners[selectedDeviceForChart.id]}
                  </p>
                )}
                {chartLastUpdated && (
                  <p className="text-xs text-gray-600 mt-1">
                    Updated: {formatVNTime(chartLastUpdated, true)} (GMT+7)
                  </p>
                )}
              </div>
              <button
                onClick={() => {
                  setShowChartModal(false)
                  setSelectedDeviceForChart(null)
                  setChartData([])
                  setChartStats({ average: 0, min: 0, max: 0 })
                }}
                className="p-2 hover:bg-dark-700 rounded-lg transition-all"
              >
                <X className="w-6 h-6 text-gray-400" />
              </button>
            </div>

            {chartLoading ? (
              <div className="flex items-center justify-center h-96">
                <p className="text-gray-400">Loading chart data...</p>
              </div>
            ) : chartData.length > 0 ? (
              <div className="space-y-6">
                {/* Statistics Cards */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-dark-900/50 border border-neon-cyan/30 rounded-lg p-4">
                    <p className="text-xs text-gray-400 mb-2">Average</p>
                    <p className="text-2xl font-bold text-neon-cyan">
                      {chartStats.average}
                      <span className="text-sm text-gray-400 ml-1">{getMetricUnit(selectedDeviceForChart.device_type)}</span>
                    </p>
                  </div>
                  <div className="bg-dark-900/50 border border-neon-green/30 rounded-lg p-4">
                    <p className="text-xs text-gray-400 mb-2">Minimum</p>
                    <p className="text-2xl font-bold text-neon-green">
                      {chartStats.min}
                      <span className="text-sm text-gray-400 ml-1">{getMetricUnit(selectedDeviceForChart.device_type)}</span>
                    </p>
                  </div>
                  <div className="bg-dark-900/50 border border-neon-orange/30 rounded-lg p-4">
                    <p className="text-xs text-gray-400 mb-2">Maximum</p>
                    <p className="text-2xl font-bold text-neon-orange">
                      {chartStats.max}
                      <span className="text-sm text-gray-400 ml-1">{getMetricUnit(selectedDeviceForChart.device_type)}</span>
                    </p>
                  </div>
                </div>

                {/* Chart */}
                <div className="bg-dark-900/50 rounded-lg p-6 border border-gray-700">
                  <ResponsiveContainer width="100%" height={400}>
                    <LineChart data={chartData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis 
                        dataKey="time" 
                        stroke="#9CA3AF"
                        tick={{ fontSize: 12 }}
                      />
                      <YAxis 
                        stroke="#9CA3AF"
                        tick={{ fontSize: 12 }}
                        label={{ value: getMetricUnit(selectedDeviceForChart.device_type), angle: -90, position: 'insideLeft' }}
                      />
                      <Tooltip 
                        contentStyle={{
                          backgroundColor: '#1a1a2e',
                          border: '1px solid #00d4ff',
                          borderRadius: '8px'
                        }}
                        labelStyle={{ color: '#fff' }}
                      />
                      <Legend />
                      <Line 
                        type="monotone" 
                        dataKey="value" 
                        stroke="#00d4ff" 
                        dot={false}
                        strokeWidth={2}
                        name={`${selectedDeviceForChart.device_type} (actual)`}
                      />
                      <Line
                        type="monotone"
                        dataKey="predictedValue"
                        stroke="#facc15"
                        dot={false}
                        strokeWidth={2}
                        strokeDasharray="7 6"
                        name="forecast (30m)"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-96">
                <p className="text-gray-400">No data available for this period</p>
              </div>
            )}

            <div className="flex gap-3 pt-6">
              <button
                onClick={() => {
                  setShowChartModal(false)
                  setSelectedDeviceForChart(null)
                  setChartData([])
                  setShortForecast([])
                  setChartStats({ average: 0, min: 0, max: 0 })
                }}
                className="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-all"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showSensorContextModal && selectedDeviceForContext && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-dark-800 border border-neon-cyan/20 rounded-xl p-6 max-w-2xl w-full mx-4">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-2xl font-bold text-white">AI Context</h3>
                <p className="text-sm text-gray-400 mt-1">{selectedDeviceForContext.name}</p>
              </div>
              <button onClick={closeSensorContextModal} className="text-gray-400 hover:text-white">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-300 mb-2">Môi trường lắp đặt</label>
                <select
                  name="environment_type"
                  value={sensorContextForm.environment_type}
                  onChange={handleSensorContextChange}
                  className="w-full bg-dark-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:border-neon-cyan outline-none"
                >
                  <option value="indoor">Trong nhà</option>
                  <option value="outdoor">Ngoài trời</option>
                </select>
              </div>

              {sensorContextForm.environment_type === 'outdoor' && (
                <div>
                  <label className="block text-sm text-gray-300 mb-2">Khu vực ngoài trời</label>
                  <input
                    type="text"
                    list="vn-province-options"
                    value={sensorContextForm.location_query}
                    onChange={(e) => {
                      setSensorContextForm((prev) => ({ ...prev, location_query: e.target.value }))
                      setContextLocationCheck({
                        checked: false,
                        success: false,
                        message: '',
                      })
                    }}
                    placeholder="Chọn hoặc gõ để tìm tỉnh/thành chuẩn hóa..."
                    className="w-full bg-dark-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:border-neon-cyan outline-none mb-2"
                  />
                  <datalist id="vn-province-options">
                    {VIETNAM_PROVINCES.map((loc) => (
                      <option key={loc} value={loc} />
                    ))}
                  </datalist>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleCheckContextLocation}
                      disabled={checkingContextLocation || !sensorContextForm.location_query}
                      className="px-3 py-2 bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/40 rounded-lg hover:border-neon-cyan transition-all disabled:opacity-50"
                    >
                      {checkingContextLocation ? 'Đang kiểm tra...' : 'Kiểm tra vị trí'}
                    </button>
                  </div>
                  {contextLocationCheck.checked && (
                    <p className={`text-xs mt-2 ${contextLocationCheck.success ? 'text-green-400' : 'text-red-400'}`}>
                      {contextLocationCheck.message}
                    </p>
                  )}
                </div>
              )}

              <div>
                <label className="block text-sm text-gray-300 mb-2">Mô tả nhiệm vụ sensor (tuỳ chọn)</label>
                <input
                  type="text"
                  name="task_description"
                  value={sensorContextForm.task_description}
                  onChange={handleSensorContextChange}
                  placeholder="Ví dụ: theo dõi nhiệt độ phòng khách"
                  className="w-full bg-dark-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:border-neon-cyan outline-none"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-2">Mức ưu tiên</label>
                <select
                  name="priority_level"
                  value={sensorContextForm.priority_level}
                  onChange={handleSensorContextChange}
                  className="w-full bg-dark-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:border-neon-cyan outline-none"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-2">Gợi ý hành động ban đầu (tuỳ chọn)</label>
                <input
                  type="text"
                  name="action_hint"
                  value={sensorContextForm.action_hint}
                  onChange={handleSensorContextChange}
                  placeholder="Ví dụ: kiểm tra quạt và thông gió"
                  className="w-full bg-dark-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:border-neon-cyan outline-none"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={closeSensorContextModal}
                className="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-all"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={saveSensorContext}
                disabled={savingSensorContext}
                className="flex-1 px-4 py-2 bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/40 rounded-lg hover:border-neon-cyan transition-all disabled:opacity-50"
              >
                {savingSensorContext ? 'Đang lưu...' : 'Lưu AI Context'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showWifiModal && selectedDeviceForWifi && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-dark-800 border border-sky-400/30 rounded-xl p-6 max-w-xl w-full mx-4">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-2xl font-bold text-white">WiFi Configuration</h3>
                <p className="text-sm text-gray-400 mt-1">{selectedDeviceForWifi.name} ({selectedDeviceForWifi.source})</p>
              </div>
              <button onClick={closeWifiModal} className="text-gray-400 hover:text-white">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-4 py-3">
                <p className="text-sm text-emerald-200">
                  {wifiStatus?.connected
                    ? `ESP32 đang nối WiFi: ${wifiStatus?.ssid || '(không rõ SSID)'}`
                    : 'ESP32 hiện chưa có WiFi đang kết nối'}
                </p>
                <p className="mt-1 text-xs text-emerald-100/80">
                  {wifiStatus?.ip ? `IP: ${wifiStatus.ip}` : 'Chưa có IP'}
                  {typeof wifiStatus?.rssi === 'number' ? ` • RSSI: ${wifiStatus.rssi} dBm` : ''}
                  {wifiStatus?.configured_ssid ? ` • WiFi đã lưu: ${wifiStatus.configured_ssid}` : ''}
                </p>
                <p className="mt-1 text-xs text-emerald-100/60">
                  {wifiStatus?.received_at
                    ? `Trạng thái nhận lúc: ${formatVNTime(wifiStatus.received_at, true)} (GMT+7)`
                    : 'Chưa nhận được trạng thái WiFi từ ESP32'}
                </p>
              </div>

              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-gray-300">Danh sách WiFi gần ESP32</p>
                <button
                  type="button"
                  onClick={handleRefreshWifiList}
                  disabled={wifiLoading}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-sky-500/20 text-sky-300 border border-sky-400/40 rounded-lg hover:border-sky-300 transition-all disabled:opacity-50"
                >
                  <RefreshCcw className="w-4 h-4" />
                  {wifiLoading ? 'Đang quét...' : 'Quét lại'}
                </button>
              </div>

              <select
                value={wifiForm.ssid}
                onChange={(e) => setWifiForm((prev) => ({ ...prev, ssid: e.target.value }))}
                className="w-full bg-dark-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:border-sky-400 outline-none"
              >
                <option value="">Chọn WiFi từ danh sách...</option>
                {wifiNetworks.map((network, index) => (
                  <option key={`${network?.ssid || 'wifi'}_${index}`} value={network?.ssid || ''}>
                    {network?.ssid || '(hidden)'} {typeof network?.rssi === 'number' ? `(${network.rssi} dBm)` : ''}
                  </option>
                ))}
              </select>

              <div>
                <label className="block text-sm text-gray-300 mb-2">Hoặc nhập SSID thủ công</label>
                <input
                  type="text"
                  value={wifiForm.ssid}
                  onChange={(e) => setWifiForm((prev) => ({ ...prev, ssid: e.target.value }))}
                  placeholder="Tên WiFi"
                  className="w-full bg-dark-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:border-sky-400 outline-none"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-2">Mật khẩu WiFi</label>
                <input
                  type="password"
                  value={wifiForm.password}
                  onChange={(e) => setWifiForm((prev) => ({ ...prev, password: e.target.value }))}
                  placeholder="Mật khẩu (để trống nếu open network)"
                  className="w-full bg-dark-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:border-sky-400 outline-none"
                />
              </div>

              <p className="text-xs text-gray-500">
                {wifiReceivedAt ? `Cập nhật gần nhất: ${formatVNTime(wifiReceivedAt, true)} (GMT+7)` : 'Chưa nhận được danh sách WiFi từ ESP32'}
              </p>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={closeWifiModal}
                className="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-all"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleSubmitWifiConfig}
                disabled={wifiSubmitting}
                className="flex-1 px-4 py-2 bg-sky-500/20 text-sky-300 border border-sky-400/40 rounded-lg hover:border-sky-300 transition-all disabled:opacity-50"
              >
                {wifiSubmitting ? 'Đang gửi...' : 'Lưu WiFi'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Device Modal - for Users */}
      {!isAdmin && (
        <AddDeviceModal
          isOpen={showAddDeviceModal}
          onClose={() => setShowAddDeviceModal(false)}
          onAdd={handleAddDevice}
          isLoading={addingDevice}
        />
      )}

      {/* Edit Alert Thresholds Modal */}
      {!isAdmin && (
        <EditAlertThresholdsModal
          isOpen={showAlertThresholdsModal}
          onClose={() => setShowAlertThresholdsModal(false)}
          onUpdate={handleSaveAlertThresholds}
          device={selectedDeviceForAlert}
          isLoading={savingAlerts}
        />
      )}
    </div>
  )
}
