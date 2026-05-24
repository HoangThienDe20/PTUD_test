import { useState, useEffect, useRef } from 'react'
import { Server, Check, ShoppingCart, Zap, Cpu, Activity, X, DollarSign, AlertCircle, CheckCircle, XCircle, Edit, Copy } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { useDevices } from '../context/DeviceContext'
import { useAuth } from '../context/AuthContext'
import { useNotification } from '../context/NotificationContext'
import api from '../api'

export default function ServerStore() {
  const { user } = useAuth()
  const { notify } = useNotification()
  const { availableServers, myServers, loading } = useDevices()
  const isDev = import.meta.env.DEV
  const [subscribing, setSubscribing] = useState({})
  const [localhostMetrics, setLocalhostMetrics] = useState({ cpu: null, memory: null })
  const [loadingMetrics, setLoadingMetrics] = useState(false)
  const [showChartModal, setShowChartModal] = useState(false)
  const [chartData, setChartData] = useState([])
  const [chartLoading, setChartLoading] = useState(false)
  const [cpuStats, setCpuStats] = useState({ average: 0, min: 0, max: 0 })
  const [memoryStats, setMemoryStats] = useState({ average: 0, min: 0, max: 0 })
  const [userRequests, setUserRequests] = useState([])
  const [requestsLoading, setRequestsLoading] = useState(false)
  const [myRentals, setMyRentals] = useState([])
  const [rentModal, setRentModal] = useState({ open: false, action: 'rent', server: null, rentalId: null, challengeId: null, code: '' })
  const [rentalDetailModal, setRentalDetailModal] = useState({ open: false, rental: null })
  const [copiedKey, setCopiedKey] = useState('')
  const [rentCodeInputs, setRentCodeInputs] = useState(['', '', '', '', '', ''])
  const [rentActionLoading, setRentActionLoading] = useState(false)
  const [rentTimeLeft, setRentTimeLeft] = useState(12)
  const RENT_CODE_TIMEOUT_SECONDS = 12
  const rentInputRefs = useRef([])
  
  // Admin state
  const [allServers, setAllServers] = useState([])
  const [pendingRequests, setPendingRequests] = useState([])
  const [pendingRequestsError, setPendingRequestsError] = useState('')
  const [adminRentals, setAdminRentals] = useState([])
  const [editingPrice, setEditingPrice] = useState({})
  const [updatingServer, setUpdatingServer] = useState(null)
  const [showRequestsModal, setShowRequestsModal] = useState(false)
  const [selectedServerForRequests, setSelectedServerForRequests] = useState(null)
  const [processingRequest, setProcessingRequest] = useState(null)
  const [showEditModal, setShowEditModal] = useState(false)
  const [selectedServerForEdit, setSelectedServerForEdit] = useState(null)
  const [editFormData, setEditFormData] = useState({})
  const [creatingLocalhostServer, setCreatingLocalhostServer] = useState(false)
  const [systemInfo, setSystemInfo] = useState({ cpu_cores: 0, ram_gb: 0, os_type: '' })
  const [loadingSystemInfo, setLoadingSystemInfo] = useState(false)
  const [adminServerMetrics, setAdminServerMetrics] = useState({})
  const [showServerChartModal, setShowServerChartModal] = useState(false)
  const [selectedServerForChart, setSelectedServerForChart] = useState(null)
  const [serverChartData, setServerChartData] = useState([])
  const [serverChartLoading, setServerChartLoading] = useState(false)
  const [serverCpuStats, setServerCpuStats] = useState({ average: 0, min: 0, max: 0 })
  const [serverMemoryStats, setServerMemoryStats] = useState({ average: 0, min: 0, max: 0 })
  const [userServerConnectionStatus, setUserServerConnectionStatus] = useState({})
  
  // Subscription duration modal state
  const [showDurationModal, setShowDurationModal] = useState(false)
  const [selectedServerForDuration, setSelectedServerForDuration] = useState(null)
  const [selectedDuration, setSelectedDuration] = useState(1)
  
  // Subscribers modal state
  const [showSubscribersModal, setShowSubscribersModal] = useState(false)
  const [selectedServerForSubscribers, setSelectedServerForSubscribers] = useState(null)
  const [subscribersList, setSubscribersList] = useState([])
  const [loadingSubscribers, setLoadingSubscribers] = useState(false)
  const [showRentersModal, setShowRentersModal] = useState(false)
  const [selectedServerForRenters, setSelectedServerForRenters] = useState(null)
  const [userViewTab, setUserViewTab] = useState('store')

  const isAdmin = user?.role === 'admin'
  const VN_TIMEZONE = 'Asia/Ho_Chi_Minh'
  const parseAsUTCIfNaive = (value) => {
    if (!value) return new Date()
    if (value instanceof Date) return value
    if (typeof value === 'string') {
      // Remote backend currently returns UTC timestamps without timezone suffix.
      // If timezone is missing, force UTC by appending "Z".
      const hasTimezone = /([zZ]|[+\-]\d{2}:\d{2})$/.test(value)
      return new Date(hasTimezone ? value : `${value}Z`)
    }
    return new Date(value)
  }
  const formatVNTime = (value) => {
    const dt = parseAsUTCIfNaive(value)
    return dt.toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: VN_TIMEZONE,
    })
  }
  const formatVNDate = (value) => {
    if (!value) return '-'
    const dt = parseAsUTCIfNaive(value)
    return dt.toLocaleDateString('vi-VN', { timeZone: VN_TIMEZONE })
  }

  useEffect(() => {
    if (isDev) console.log('[ServerStore] Effect triggered - isAdmin:', isAdmin, 'user:', user)
    if (isAdmin) {
      if (isDev) console.log('[ServerStore] Calling fetchAllServers because isAdmin=true')
      fetchAllServers()
      fetchAllRentals()
      fetchSystemInfo() // Fetch system info when admin view loads
    } else {
      if (isDev) console.log('[ServerStore] User is not admin, calling fetchUserAvailableServers')
      fetchUserAvailableServers()
      fetchMyRentals()
    }
  }, [isAdmin, user, isDev])

  useEffect(() => {
    if (!isAdmin) return

    const interval = setInterval(() => {
      fetchAllRentals()
    }, 5000)

    return () => clearInterval(interval)
  }, [isAdmin])

  // Fetch localhost metrics every 5 seconds
  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        setLoadingMetrics(true)
        const response = await api.get('/api/metrics/latest', {
          params: { source: 'system_monitor' }
        })
        if (response.data) {
          setLocalhostMetrics({
            cpu: response.data.latest_cpu,
            memory: response.data.latest_memory
          })
        }
      } catch (err) {
        console.error('Failed to fetch metrics:', err)
      } finally {
        setLoadingMetrics(false)
      }
    }

    fetchMetrics()
    const interval = setInterval(fetchMetrics, 5000)
    return () => clearInterval(interval)
  }, [])

  // Fetch chart data for localhost (past 2 hours = 120 minutes)
  const handleOpenChart = async () => {
    setShowChartModal(true)
    setChartLoading(true)
    try {
      // Fetch both CPU and Memory history
      const [cpuRes, memoryRes] = await Promise.all([
        api.get('/api/metrics/history', { params: { metric_type: 'cpu', minutes: 120 } }),
        api.get('/api/metrics/history', { params: { metric_type: 'memory', minutes: 120 } })
      ])

      // Transform and merge data
      const cpuData = cpuRes.data.data || []
      const memoryData = memoryRes.data.data || []

      // Create map for quick lookup
      const cpuMap = {}
      cpuData.forEach(item => {
        const key = formatVNTime(item.timestamp)
        cpuMap[key] = item.value
      })

      const memoryMap = {}
      memoryData.forEach(item => {
        const key = formatVNTime(item.timestamp)
        memoryMap[key] = item.value
      })

      // Merge all timestamps and create chart data
      const allTimestamps = new Set([...Object.keys(cpuMap), ...Object.keys(memoryMap)])
      const mergedData = Array.from(allTimestamps)
        .sort()
        .map(time => ({
          time,
          cpu: cpuMap[time] || null,
          memory: memoryMap[time] || null
        }))

      // Calculate statistics for CPU
      const cpuValues = cpuData.map(d => d.value)
      if (cpuValues.length > 0) {
        const avgCpu = cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length
        setCpuStats({
          average: parseFloat(avgCpu.toFixed(2)),
          min: parseFloat(Math.min(...cpuValues).toFixed(2)),
          max: parseFloat(Math.max(...cpuValues).toFixed(2))
        })
      }

      // Calculate statistics for Memory
      const memoryValues = memoryData.map(d => d.value)
      if (memoryValues.length > 0) {
        const avgMemory = memoryValues.reduce((a, b) => a + b, 0) / memoryValues.length
        setMemoryStats({
          average: parseFloat(avgMemory.toFixed(2)),
          min: parseFloat(Math.min(...memoryValues).toFixed(2)),
          max: parseFloat(Math.max(...memoryValues).toFixed(2))
        })
      }

      setChartData(mergedData)
    } catch (err) {
      console.error('Failed to fetch chart data:', err)
      setChartData([])
      setCpuStats({ average: 0, min: 0, max: 0 })
      setMemoryStats({ average: 0, min: 0, max: 0 })
    } finally {
      setChartLoading(false)
    }
  }

  const handleCloseChart = () => {
    setShowChartModal(false)
    setChartData([])
    setCpuStats({ average: 0, min: 0, max: 0 })
    setMemoryStats({ average: 0, min: 0, max: 0 })
  }

  // ===== ADMIN FUNCTIONS =====
  const fetchAllServers = async () => {
    try {
      if (isDev) console.log('[ServerStore] isAdmin:', isAdmin)
      if (isDev) console.log('[ServerStore] Calling /api/servers/admin/servers')
      const response = await api.get('/api/servers/admin/servers')
      if (isDev) console.log('[ServerStore] Full response:', response)
      if (isDev) console.log('[ServerStore] Fetched all servers for admin:', response.data.servers)
      if (isDev) console.log('[ServerStore] Servers length:', response.data.servers?.length)
      setAllServers(response.data.servers || [])
    } catch (err) {
      console.error('[ServerStore] Failed to fetch servers - Error:', err)
      console.error('[ServerStore] Error response data:', err.response?.data)
      console.error('[ServerStore] Error status:', err.response?.status)
    }
  }

  const fetchUserAvailableServers = async () => {
    try {
      const response = await api.get('/api/servers')
      if (isDev) console.log('[ServerStore] Fetched available servers for user:', response.data.servers)
      // Store in a separate state for user view
      if (!isAdmin) {
        setAllServers(response.data.servers || [])
      }
    } catch (err) {
      console.error('Failed to fetch available servers:', err)
    }
  }

  const fetchPendingRequests = async () => {
    setPendingRequests([])
    setPendingRequestsError('')
  }

  const fetchAllRentals = async () => {
    try {
      const response = await api.get('/api/servers/rentals')
      setAdminRentals(response?.data?.rentals || [])
    } catch (err) {
      console.error('Failed to fetch rentals:', err)
      setAdminRentals([])
    }
  }

  const getRequestsForServer = (serverId) => {
    return pendingRequests.filter(r => r.server_id === serverId)
  }

  const fetchSubscribersForServer = async (serverId) => {
    try {
      setLoadingSubscribers(true)
      const response = await api.get(`/api/servers/${serverId}/subscribers`)
      setSubscribersList(response.data.subscribers || [])
    } catch (err) {
      console.error('Failed to fetch subscribers:', err)
      setSubscribersList([])
    } finally {
      setLoadingSubscribers(false)
    }
  }

  const openSubscribersModal = (serverId) => {
    setSelectedServerForSubscribers(serverId)
    setShowSubscribersModal(true)
    fetchSubscribersForServer(serverId)
  }

  const closeSubscribersModal = () => {
    setShowSubscribersModal(false)
    setSelectedServerForSubscribers(null)
    setSubscribersList([])
  }

  const openRentersModal = (server) => {
    setSelectedServerForRenters(server)
    setShowRentersModal(true)
  }

  const closeRentersModal = () => {
    setShowRentersModal(false)
    setSelectedServerForRenters(null)
  }

  const getRentalsForServer = (serverId) => {
    const key = String(serverId)
    return adminRentals.filter((r) => String(r.server_id) === key)
  }

  const updateServerPrice = async (serverId, newPrice) => {
    try {
      setUpdatingServer(serverId)
      await api.put(`/api/servers/admin/servers/${serverId}/price`, null, {
        params: { price_per_month: parseFloat(newPrice) }
      })
      await fetchAllServers()
      setEditingPrice(prev => {
        const newState = { ...prev }
        delete newState[serverId]
        return newState
      })
      notify(`Price updated to $${newPrice}/month`)
    } catch (err) {
      notify('Error: ' + (err.response?.data?.detail || err.message))
    } finally {
      setUpdatingServer(null)
    }
  }

  const approveRequest = async (requestId) => {
    notify('Luồng duyệt subscription cũ đã bị gỡ. Hãy dùng luồng thuê server bằng mã xác nhận.')
  }

  const rejectRequest = async (requestId) => {
    notify('Luồng duyệt subscription cũ đã bị gỡ. Hãy dùng luồng thuê server bằng mã xác nhận.')
  }

  // ===== SERVER EDIT FUNCTIONS =====
  const fetchSystemInfo = async () => {
    try {
      setLoadingSystemInfo(true)
      const response = await api.get('/api/servers/admin/system-info')
      setSystemInfo(response.data)
    } catch (err) {
      console.error('Failed to fetch system info:', err)
      setSystemInfo({ cpu_cores: 0, ram_gb: 0, os_type: '' })
    } finally {
      setLoadingSystemInfo(false)
    }
  }

  const openEditModal = (server) => {
    setSelectedServerForEdit(server)
    setEditFormData({
      name: server.name,
      specs: server.specifications || server.specs,
      price_per_month: Number(server.price_per_month || 0),
      cpu_cores: server.cpu_cores || 0,
      ram_gb: server.ram_gb || 0,
      os_type: server.os_type || ''
    })
    setShowEditModal(true)

    // Only refresh host hardware info when editing localhost server
    if (localhostServer && server.id === localhostServer.id) {
      fetchSystemInfo()
    }
  }

  const closeEditModal = () => {
    setShowEditModal(false)
    setSelectedServerForEdit(null)
    setEditFormData({})
    // Don't clear systemInfo - it's needed for server card display
  }

  const saveServerEdit = async () => {
    if (!selectedServerForEdit) return

    try {
      setUpdatingServer(selectedServerForEdit.id)

      const monthlyPrice = Number(editFormData.price_per_month ?? 0)
      const pricePerMonth = Number.isFinite(monthlyPrice) ? monthlyPrice : 0
      await api.patch(`/api/servers/admin/servers/${selectedServerForEdit.id}`, {
        name: editFormData.name,
        specs: editFormData.specs,
        price_per_month: pricePerMonth
      })
      await fetchAllServers()
      notify('Server metadata updated successfully.')
      closeEditModal()
    } catch (err) {
      console.error('Update error:', err)
      notify('Error: ' + (err.response?.data?.detail || err.message))
    } finally {
      setUpdatingServer(null)
    }
  }

  // ===== SERVER CHART FUNCTIONS =====
  const fetchServerChart = async (serverId, serverName) => {
    setShowServerChartModal(true)
    setSelectedServerForChart(serverName || String(serverId))
    setServerChartLoading(true)
    try {
      const historyRes = await api.get(`/api/servers/${serverId}/history`)
      const historyData = historyRes?.data?.history || []

      const mergedData = historyData.map((item) => {
        const ts = item.created_at || item.timestamp || item.last_updated
        return {
          time: formatVNTime(ts || new Date().toISOString()),
          cpu: item.cpu ?? null,
          memory: item.ram ?? null
        }
      })

      const cpuValues = mergedData.map(d => d.cpu).filter(v => v !== null)
      if (cpuValues.length > 0) {
        const avgCpu = cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length
        setServerCpuStats({
          average: parseFloat(avgCpu.toFixed(2)),
          min: parseFloat(Math.min(...cpuValues).toFixed(2)),
          max: parseFloat(Math.max(...cpuValues).toFixed(2))
        })
      }

      const memoryValues = mergedData.map(d => d.memory).filter(v => v !== null)
      if (memoryValues.length > 0) {
        const avgMemory = memoryValues.reduce((a, b) => a + b, 0) / memoryValues.length
        setServerMemoryStats({
          average: parseFloat(avgMemory.toFixed(2)),
          min: parseFloat(Math.min(...memoryValues).toFixed(2)),
          max: parseFloat(Math.max(...memoryValues).toFixed(2))
        })
      }

      setServerChartData(mergedData)
    } catch (err) {
      console.error('Failed to fetch chart data:', err)
      setServerChartData([])
      setServerCpuStats({ average: 0, min: 0, max: 0 })
      setServerMemoryStats({ average: 0, min: 0, max: 0 })
    } finally {
      setServerChartLoading(false)
    }
  }

  const closeServerChartModal = () => {
    setShowServerChartModal(false)
    setSelectedServerForChart(null)
    setServerChartData([])
    setServerCpuStats({ average: 0, min: 0, max: 0 })
    setServerMemoryStats({ average: 0, min: 0, max: 0 })
  }

  // ===== USER FUNCTIONS =====
  const fetchUserRequests = async () => {
    setRequestsLoading(false)
    setUserRequests([])
  }

  const fetchMyRentals = async () => {
    try {
      const response = await api.get('/api/servers/my-rentals')
      setMyRentals(response?.data?.rentals || [])
    } catch (err) {
      console.error('Failed to fetch my rentals:', err)
      setMyRentals([])
    }
  }

  const getRentalByServer = (serverId) => {
    const key = String(serverId)
    return myRentals.find((r) => String(r.server_id) === key && r.status !== 'cancelled')
  }

  const openRentModal = async (server) => {
    try {
      setRentActionLoading(true)
      const response = await api.post('/api/servers/rent/request', { server_id: server.server_id || server.id })
      const challengeId = response?.data?.challenge_id
      const code = response?.data?.verification_code || ''
      setRentCodeInputs(['', '', '', '', '', ''])
      setRentTimeLeft(RENT_CODE_TIMEOUT_SECONDS)
      setRentModal({ open: true, action: 'rent', server, rentalId: null, challengeId, code })
    } catch (err) {
      notify('Error: ' + (err.response?.data?.detail || err.message))
    } finally {
      setRentActionLoading(false)
    }
  }

  const handleCodeInputChange = (index, value) => {
    const digit = (value || '').replace(/\D/g, '').slice(-1)
    const next = [...rentCodeInputs]
    next[index] = digit
    setRentCodeInputs(next)
    if (digit && index < 5) {
      rentInputRefs.current[index + 1]?.focus()
    }
  }

  const handleCodeKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !rentCodeInputs[index] && index > 0) {
      rentInputRefs.current[index - 1]?.focus()
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (rentCodeInputs.join('').length === 6 && !rentActionLoading) {
        confirmCodeAction()
      }
    }
  }

  const closeRentModal = () => {
    setRentModal({ open: false, action: 'rent', server: null, rentalId: null, challengeId: null, code: '' })
    setRentCodeInputs(['', '', '', '', '', ''])
    setRentTimeLeft(RENT_CODE_TIMEOUT_SECONDS)
  }

  const confirmCodeAction = async () => {
    const code = rentCodeInputs.join('').trim()
    if (code.length !== 6) {
      notify('Vui lòng nhập đủ 6 chữ số')
      return
    }
    try {
      setRentActionLoading(true)
      if (rentModal.action === 'rent') {
        await api.post('/api/servers/rent/confirm', { challenge_id: rentModal.challengeId, code })
        closeRentModal()
        await fetchMyRentals()
        notify('Thuê server thành công')
      } else if (rentModal.action === 'download_key') {
        const response = await api.post('/api/servers/rentals/private-key/confirm', {
          challenge_id: rentModal.challengeId,
          code,
        })
        const key = response?.data?.private_key || ''
        const filename = response?.data?.private_key_filename || 'key.pem'
        const blob = new Blob([key], { type: 'text/plain' })
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        a.remove()
        window.URL.revokeObjectURL(url)
        closeRentModal()
        await fetchMyRentals()
        notify('Tải private key thành công')
      } else if (rentModal.action === 'cancel_rental') {
        await api.post('/api/servers/rentals/cancel/confirm', {
          challenge_id: rentModal.challengeId,
          code,
        })
        closeRentModal()
        await fetchMyRentals()
        if (isAdmin) await fetchAllRentals()
        notify('Đã hủy đăng ký server')
      }
    } catch (err) {
      const detail = String(err.response?.data?.detail || err.message || '')
      const normalized = detail.toLowerCase()

      if (normalized.includes('invalid verification code')) {
        notify('Mã xác nhận không đúng. Vui lòng kiểm tra lại 6 chữ số.')
      } else if (normalized.includes('challenge expired')) {
        notify('Mã xác nhận đã hết hạn. Vui lòng thao tác lại để nhận mã mới.')
      } else if (
        normalized.includes('useradd') ||
        normalized.includes('/etc/passwd') ||
        normalized.includes('permission denied')
      ) {
        notify('Mã xác nhận đúng, nhưng server đích đang lỗi phân quyền khi tạo tài khoản VPS. Vui lòng thử lại sau hoặc báo admin kiểm tra máy chủ.')
      } else {
        notify('Error: ' + detail)
      }
    } finally {
      setRentActionLoading(false)
    }
  }

  const requestCancelRental = async (rentalId) => {
    try {
      setRentActionLoading(true)
      const response = await api.post('/api/servers/rentals/cancel/request', { rental_id: rentalId })
      const challengeId = response?.data?.challenge_id
      const code = response?.data?.verification_code || ''
      setRentCodeInputs(['', '', '', '', '', ''])
      setRentTimeLeft(RENT_CODE_TIMEOUT_SECONDS)
      setRentModal({ open: true, action: 'cancel_rental', server: null, rentalId, challengeId, code })
    } catch (err) {
      notify('Error: ' + (err.response?.data?.detail || err.message))
    } finally {
      setRentActionLoading(false)
    }
  }

  const requestDownloadPrivateKey = async (rentalId) => {
    try {
      const response = await api.post('/api/servers/rentals/private-key/request', { rental_id: rentalId })
      const challengeId = response?.data?.challenge_id
      const code = response?.data?.verification_code || ''
      setRentCodeInputs(['', '', '', '', '', ''])
      setRentTimeLeft(RENT_CODE_TIMEOUT_SECONDS)
      setRentModal({ open: true, action: 'download_key', server: null, rentalId, challengeId, code })
    } catch (err) {
      notify('Error: ' + (err.response?.data?.detail || err.message))
    }
  }

  useEffect(() => {
    if (!rentModal.open) return
    rentInputRefs.current[0]?.focus()
    const timer = setInterval(() => {
      if (rentActionLoading) return
      setRentTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          closeRentModal()
          notify('Mã xác nhận đã hết thời gian. Vui lòng thao tác lại.')
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [rentModal.open, rentActionLoading])

  const handleRequestSubscription = async (serverId, durationMonths = 1) => {
    try {
      setSubscribing(prev => ({ ...prev, [serverId]: true }))
      const server = (allServers || []).find((item) => String(item.server_id || item.id) === String(serverId))
      if (!server) {
        notify('Không tìm thấy server để chuyển sang luồng thuê mới.')
        return
      }
      await openRentModal(server)
    } catch (err) {
      notify('Error: ' + (err.response?.data?.detail || err.message))
    } finally {
      setSubscribing(prev => ({ ...prev, [serverId]: false }))
    }
  }

  const getRequestStatus = (serverId) => {
    const request = userRequests.find(r => r.server_id === serverId)
    return request
  }

  const isSubscribed = (serverId) => {
    const key = String(serverId)
    return myServers.some((s) => String(s.id || s.server_id) === key)
  }

  const handleSubscribe = (serverId) => {
    // Open duration selection modal instead of immediately subscribing
    setSelectedServerForDuration(serverId)
    setSelectedDuration(1)  // Default to 1 month
    setShowDurationModal(true)
  }

  const handleConfirmSubscription = async () => {
    try {
      await handleRequestSubscription(selectedServerForDuration, selectedDuration)
      setShowDurationModal(false)
    } catch (err) {
      notify('Error: ' + err.message)
    }
  }

  const getServerColor = (index) => {
    const colors = ['neon-cyan', 'neon-green', 'neon-purple', 'neon-orange']
    return colors[index % colors.length]
  }

  const SERVER_COLOR_STYLES = {
    'neon-cyan': {
      border: 'border-neon-cyan/30 hover:border-neon-cyan/60',
      title: 'text-neon-cyan',
      statusText: 'text-neon-cyan',
      button: 'bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/40 hover:border-neon-cyan',
    },
    'neon-green': {
      border: 'border-neon-green/30 hover:border-neon-green/60',
      title: 'text-neon-green',
      statusText: 'text-neon-green',
      button: 'bg-neon-green/20 text-neon-green border border-neon-green/40 hover:border-neon-green',
    },
    'neon-purple': {
      border: 'border-neon-purple/30 hover:border-neon-purple/60',
      title: 'text-neon-purple',
      statusText: 'text-neon-purple',
      button: 'bg-neon-purple/20 text-neon-purple border border-neon-purple/40 hover:border-neon-purple',
    },
    'neon-orange': {
      border: 'border-neon-orange/30 hover:border-neon-orange/60',
      title: 'text-neon-orange',
      statusText: 'text-neon-orange',
      button: 'bg-neon-orange/20 text-neon-orange border border-neon-orange/40 hover:border-neon-orange',
    },
  }

  const ServerCard = ({ server, index }) => {
    const color = getServerColor(index)
    const colorStyle = SERVER_COLOR_STYLES[color] || SERVER_COLOR_STYLES['neon-cyan']
    const subscribed = isSubscribed(server.id)
    const request = getRequestStatus(server.id)
    const rental = getRentalByServer(server.server_id || server.id)
    const canSeeIp = isAdmin || !!rental
    const canOpenStatusChart = isAdmin || !!rental

    const getButtonState = () => {
      if (isAdmin) {
        return { disabled: true, text: 'Admin View', status: 'subscribed', icon: Activity }
      }
      if (rental && rental.status !== 'cancelled') {
        return { disabled: true, text: 'Đang thuê', status: 'subscribed', icon: Check }
      }
      const serverUnavailable = server.status !== 'online' || server.rented
      if (serverUnavailable) {
        return { disabled: true, text: server.rented ? 'Đã có người thuê' : 'Server offline', status: 'pending', icon: X }
      }
      return { disabled: rentActionLoading, text: 'Thuê server', status: 'idle', icon: ShoppingCart }
    }

    const buttonState = getButtonState()
    const ButtonIcon = buttonState.icon

    return (
      <div
        onClick={() => {
          if (canOpenStatusChart) {
            fetchServerChart(server.server_id || server.id, server.name)
          }
        }}
        className={`bg-dark-800 border rounded-xl p-6 transition-all flex flex-col ${colorStyle.border} ${canOpenStatusChart ? 'cursor-pointer hover:bg-dark-700' : ''}`}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h3 className={`text-xl font-bold ${colorStyle.title}`}>{server.name}</h3>
            </div>
            {canSeeIp && server.ip && (
              <p className="text-xs text-gray-500 mb-2">IP: {server.ip}</p>
            )}
            <p className="text-gray-400 text-sm">{server.specifications || server.specs}</p>
          </div>
          {subscribed && (
            <span className="flex items-center gap-1 text-xs bg-green-500/20 text-green-400 px-3 py-1 rounded-full">
              <Check className="w-3 h-3" />
              Subscribed
            </span>
          )}
          {request && request.status === 'pending' && (
            <span className="flex items-center gap-1 text-xs bg-yellow-500/20 text-yellow-400 px-3 py-1 rounded-full">
              <Activity className="w-3 h-3" />
              Pending
            </span>
          )}
          {request && request.status === 'rejected' && (
            <span className="flex items-center gap-1 text-xs bg-red-500/20 text-red-400 px-3 py-1 rounded-full">
              <X className="w-3 h-3" />
              Rejected
            </span>
          )}
        </div>

        {/* Show rejection reason if exists */}
        {request && request.status === 'rejected' && request.rejection_reason && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4">
            <p className="text-xs text-red-300"><strong>Reason:</strong> {request.rejection_reason}</p>
          </div>
        )}

        {/* Specs */}
        <div className="space-y-3 mb-6 flex-1">
          {server.cpu_cores && (
            <div className="flex items-center gap-3 p-3 bg-dark-900 rounded-lg">
              <Zap className="w-5 h-5 text-neon-yellow opacity-70" />
              <div>
                <p className="text-xs text-gray-500">CPU Cores</p>
                <p className="text-lg font-bold text-white">{server.cpu_cores}</p>
              </div>
            </div>
          )}

          {server.ram_gb && (
            <div className="flex items-center gap-3 p-3 bg-dark-900 rounded-lg">
              <Server className="w-5 h-5 text-neon-cyan opacity-70" />
              <div>
                <p className="text-xs text-gray-500">Memory</p>
                <p className="text-lg font-bold text-white">{server.ram_gb}GB RAM</p>
              </div>
            </div>
          )}

          {server.os_type && (
            <div className="flex items-center gap-3 p-3 bg-dark-900 rounded-lg">
              <Server className="w-5 h-5 text-neon-purple opacity-70" />
              <div>
                <p className="text-xs text-gray-500">Operating System</p>
                <p className="text-lg font-bold text-white">{server.os_type}</p>
              </div>
            </div>
          )}
        </div>

        {/* Pricing & Button */}
        <div className="border-t border-gray-700 pt-4">
          {(server.price_per_month || 0) > 0 ? (
            <div className="mb-4">
              <p className="text-sm text-gray-500 mb-1">Monthly Price</p>
              <p className="text-2xl font-bold text-white">
                ${Number(server.price_per_month || 0).toFixed(2)}
                <span className="text-sm text-gray-400 font-normal">/month</span>
              </p>
            </div>
          ) : (
            <div className="mb-4">
              <p className="text-sm text-gray-500 mb-1">Status</p>
              <p className={`text-lg font-bold ${colorStyle.statusText}`}>Free to Monitor</p>
            </div>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation()
              if (rental && rental.status !== 'cancelled') return
              openRentModal(server)
            }}
            disabled={buttonState.disabled}
            className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg transition-all font-semibold ${
              buttonState.status === 'subscribed'
                ? 'bg-green-500/20 text-green-400 border border-green-500/40 cursor-not-allowed'
                : buttonState.status === 'pending'
                ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40 cursor-not-allowed'
                : buttonState.status === 'rejected'
                ? colorStyle.button
                : `${colorStyle.button} disabled:opacity-50`
            }`}
          >
            <ButtonIcon className="w-5 h-5" />
            {subscribing[server.id] ? 'Processing...' : buttonState.text}
          </button>
          {rental && (
            <div className="mt-3 p-3 rounded-lg bg-dark-900 border border-neon-cyan/30 text-sm text-gray-300 space-y-2">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setRentalDetailModal({ open: true, rental })
                }}
                className="px-3 py-2 rounded bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/40"
              >
                Chi tiết
              </button>
              {rental.private_key_available && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    requestDownloadPrivateKey(rental.rental_id)
                  }}
                  className="px-3 py-2 rounded bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/40"
                >
                  Tải private key
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  requestCancelRental(rental.rental_id)
                }}
                className="ml-2 px-3 py-2 rounded bg-red-500/20 text-red-300 border border-red-500/40"
              >
                Hủy đăng ký
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  const ACTIVE_RENTAL_STATUSES = ['creating', 'active', 'cancelling']
  const activeMyRentals = myRentals.filter((r) => ACTIVE_RENTAL_STATUSES.includes(r.status))
  const serverCatalog = [...(availableServers || []), ...(allServers || [])]
  const serverById = Object.fromEntries(
    serverCatalog.map((s) => [String(s.server_id || s.id), s])
  )
  const mySubscriptionsCount = activeMyRentals.length
  const myMonthlyCost = activeMyRentals.reduce((sum, r) => {
    const server = serverById[String(r.server_id)] || {}
    return sum + Number(server.price_per_month || 0)
  }, 0)
  const ACTIVE_RENTAL_STATES = ['creating', 'active', 'cancelling']
  const totalActiveSubscribers = new Set(
    adminRentals
      .filter((r) => ACTIVE_RENTAL_STATES.includes(r.status))
      .map((r) => r.renter_name || r.username)
      .filter(Boolean)
  ).size
  const myRentedServerCards = activeMyRentals.map((rental) => {
    const server = serverById[String(rental.server_id)] || {}
    return {
      ...server,
      id: server.id || rental.server_id,
      server_id: server.server_id || rental.server_id,
      name: server.display_name || rental.server_name || server.name || String(rental.server_id),
      rented: true,
    }
  })

  const localhostServer = null
  const nonLocalServers = allServers
  const localhostRequests = []

  useEffect(() => {
    let isMounted = true

    const fetchServerMetrics = async () => {
      try {
        // Both admin and user use allServers now (admin from /api/servers/admin/servers, user from /api/servers)
        const serversToCheck = allServers
        
        if (isDev) console.log(`[ServerStore] Fetching metrics for ${isAdmin ? 'admin' : 'user'} - servers count:`, serversToCheck.length, 'servers:', serversToCheck)
        
        if (serversToCheck.length === 0) {
          if (isDev) console.log('[ServerStore] No servers to check, setting empty metrics')
          setAdminServerMetrics({})
          return
        }

        const metricEntries = serversToCheck.map((server) => [
          server.id,
          {
            cpu: server?.cpu ?? null,
            memory: server?.ram ?? null
          }
        ])

        if (isMounted) {
          const metricsObj = Object.fromEntries(metricEntries)
          if (isDev) console.log('[ServerStore] Metrics fetched:', metricsObj)
          if (isDev) console.log('[ServerStore] Server 1 metrics:', metricsObj[1])
          if (isDev) console.log('[ServerStore] Server 2 metrics:', metricsObj[2])
          if (isDev) console.log('[ServerStore] Server 3 metrics:', metricsObj[3])
          setAdminServerMetrics(metricsObj)
        }
      } catch (err) {
        console.error('Failed to fetch server metrics:', err)
      }
    }

    fetchServerMetrics()
    const interval = setInterval(fetchServerMetrics, 5000)

    return () => {
      isMounted = false
      clearInterval(interval)
    }
  }, [isAdmin, allServers])

  // Separate effect to trigger metrics fetch when component first mounts
  useEffect(() => {
    if (isDev) console.log('[ServerStore] Component mounted, isAdmin:', isAdmin)
  }, [])

  const handleLocalhostEdit = async (e) => {
    e.stopPropagation()
  }

  const isEditingLocalhost = Boolean(
    selectedServerForEdit && localhostServer && selectedServerForEdit.id === localhostServer.id
  )

  const editHardwareInfo = {
    cpu_cores: isEditingLocalhost
      ? Number(systemInfo.cpu_cores) || Number(editFormData.cpu_cores) || Number(selectedServerForEdit?.cpu_cores) || 0
      : Number(editFormData.cpu_cores) || Number(selectedServerForEdit?.cpu_cores) || 0,
    ram_gb: isEditingLocalhost
      ? Number(systemInfo.ram_gb) || Number(editFormData.ram_gb) || Number(selectedServerForEdit?.ram_gb) || 0
      : Number(editFormData.ram_gb) || Number(selectedServerForEdit?.ram_gb) || 0,
    os_type: isEditingLocalhost
      ? systemInfo.os_type || editFormData.os_type || selectedServerForEdit?.os_type || 'Unknown'
      : editFormData.os_type || selectedServerForEdit?.os_type || 'Unknown'
  }

  const showEditHardwareLoading = isEditingLocalhost && loadingSystemInfo

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold text-white mb-2">
          {isAdmin ? 'Server Management' : 'Server Store'}
        </h1>
        <p className="text-gray-400">
          {isAdmin ? 'Manage servers, set prices, and review subscription requests' : 'Browse and subscribe to available servers for monitoring'}
        </p>
      </div>

      {/* ADMIN VIEW */}
      {isAdmin ? (
        <>
          {/* Admin Stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-dark-800 border border-neon-cyan/20 rounded-xl p-6">
              <p className="text-gray-400 text-sm mb-2">Total Servers</p>
              <p className="text-3xl font-bold text-neon-cyan">{allServers.length}</p>
            </div>
            <div className="bg-dark-800 border border-neon-purple/20 rounded-xl p-6">
              <p className="text-gray-400 text-sm mb-2">Total Subscribers</p>
              <p className="text-3xl font-bold text-neon-purple">{totalActiveSubscribers}</p>
            </div>
          </div>

          {pendingRequestsError && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
              <p className="text-sm text-red-300">
                Failed to load pending requests: {pendingRequestsError}
              </p>
            </div>
          )}

          {/* Servers Grid - Admin */}
          <div>
            <h2 className="text-2xl font-bold text-white mb-6">Your Servers</h2>
            
            {/* Localhost Server Card for Admin */}
            {localhostServer && (
            <div 
              onClick={() => fetchServerChart(localhostServer?.id || 1, localhostServer?.name || 'Server 1')}
              className={`mb-6 bg-dark-800 border border-neon-cyan/30 rounded-xl p-6 hover:border-neon-cyan/60 hover:cursor-pointer transition-all hover:bg-dark-700 relative ${localhostMetrics.cpu !== null ? '' : 'opacity-50'}`}
            >
              {/* Edit Button - Top Right Corner */}
              <button
                onClick={handleLocalhostEdit}
                disabled={creatingLocalhostServer}
                className="absolute top-6 right-6 flex items-center gap-2 px-3 py-1.5 bg-blue-500/20 text-blue-400 border border-blue-500/40 rounded-lg hover:bg-blue-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Edit className="w-4 h-4" />
                {creatingLocalhostServer ? 'Creating...' : 'Edit'}
              </button>

              <div className="flex items-start justify-between mb-4 pr-24">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-bold text-white">{localhostServer?.name || 'Server 1'}</h3>
                    <span className="text-xs text-neon-cyan bg-neon-cyan/20 px-2 py-1 rounded">
                      Localhost
                    </span>
                  </div>
                  <p className="text-sm text-gray-400 mb-3">{localhostServer?.specs || 'System Server - Metrics Only'}</p>

                  {/* System Info Display */}
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <div>
                      <p className="text-xs text-gray-500">CPU Cores</p>
                      <p className="text-lg font-bold text-neon-yellow">{systemInfo.cpu_cores || 0}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">RAM</p>
                      <p className="text-lg font-bold text-neon-cyan">{systemInfo.ram_gb}GB</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">OS</p>
                      <p className="text-lg font-bold text-neon-purple">{systemInfo.os_type}</p>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500 mb-1">Monthly Price</p>
                  <p className="text-xl font-bold text-neon-yellow">
                    ${localhostServer ? Number(localhostServer.price_per_month || 0).toFixed(2) : '0.00'}
                  </p>
                </div>
              </div>

              {/* Localhost Metrics Display */}
              <div className="bg-dark-900/50 rounded-lg p-4 mb-4 border border-neon-cyan/20 space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs text-gray-400">CPU Usage</p>
                    <span className="text-sm font-bold text-neon-yellow">
                      {localhostMetrics.cpu !== null ? `${localhostMetrics.cpu.toFixed(1)}%` : 'N/A'}
                    </span>
                  </div>
                  <div className="w-full bg-dark-800 rounded-full h-1.5">
                    <div
                      className="bg-neon-yellow h-1.5 rounded-full transition-all"
                      style={{ width: `${localhostMetrics.cpu || 0}%` }}
                    ></div>
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs text-gray-400">Memory Usage</p>
                    <span className="text-sm font-bold text-neon-cyan">
                      {localhostMetrics.memory !== null ? `${localhostMetrics.memory.toFixed(1)}%` : 'N/A'}
                    </span>
                  </div>
                  <div className="w-full bg-dark-800 rounded-full h-1.5">
                    <div
                      className="bg-neon-cyan h-1.5 rounded-full transition-all"
                      style={{ width: `${localhostMetrics.memory || 0}%` }}
                    ></div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
              </div>

              {/* Subscribers Button + Connection Status - Side by Side */}
              <div className="flex items-center gap-3 mb-3">
                {/* Subscribers Button - Compact */}
                {(localhostServer?.subscribers_count || 0) > 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      localhostServer && openSubscribersModal(localhostServer.id)
                    }}
                    className="px-3 py-2 bg-neon-green/20 text-neon-green border border-neon-green/60 rounded-lg hover:bg-neon-green/30 hover:border-neon-green transition-all font-semibold text-sm flex items-center gap-1.5"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v2h8v-2zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-2a4 4 0 00-8 0v2a2 2 0 002 2h4a2 2 0 002-2z"></path>
                    </svg>
                    Subscribers ({localhostServer?.subscribers_count || 0})
                  </button>
                )}

                {/* Connection Status */}
                <div className="flex items-center gap-2">
                  {localhostMetrics.cpu !== null ? (
                    <>
                      <div className="w-2 h-2 rounded-full bg-neon-green"></div>
                      <p className="text-sm font-semibold text-neon-green">Có kết nối</p>
                    </>
                  ) : (
                    <>
                      <div className="w-2 h-2 rounded-full bg-red-500"></div>
                      <p className="text-sm font-semibold text-red-400">Không có kết nối</p>
                    </>
                  )}
                </div>
              </div>

              {/* Request Badge */}
              {localhostRequests.length > 0 && localhostServer && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setSelectedServerForRequests(localhostServer)
                    setShowRequestsModal(true)
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-yellow-500/20 text-yellow-400 border border-yellow-500/40 rounded-lg hover:bg-yellow-500/30 transition-all whitespace-nowrap"
                >
                  <AlertCircle className="w-5 h-5" />
                  {localhostRequests.length} Request{localhostRequests.length !== 1 ? 's' : ''}
                </button>
              )}
            </div>
            )}

            {nonLocalServers.length === 0 ? (
              <p className="text-gray-400">No other servers available</p>
            ) : (
              <div className="space-y-4">
                {[...nonLocalServers]
                  .sort((a, b) => {
                    const aConnected = (adminServerMetrics[a.id]?.cpu ?? null) !== null
                    const bConnected = (adminServerMetrics[b.id]?.cpu ?? null) !== null
                    return bConnected - aConnected // true (1) first, false (0) last
                  })
                  .map((server) => {
                  const serverRequests = getRequestsForServer(server.id)
                  const serverMetrics = adminServerMetrics[server.id] || { cpu: null, memory: null }
                  const isConnected = serverMetrics.cpu !== null
                  const serverRentals = getRentalsForServer(server.id)
                  const activeServerRentals = serverRentals.filter((r) => ['creating', 'active', 'cancelling'].includes(r.status))

                  return (
                    <div
                      key={server.id}
                      onClick={() => fetchServerChart(server.id, server.name)}
                      className={`bg-dark-800 border border-neon-cyan/30 rounded-xl p-6 hover:border-neon-cyan/60 hover:cursor-pointer transition-all hover:bg-dark-700 relative ${isConnected ? '' : 'opacity-50'}`}
                    >
                      {/* Edit Button - Top Right Corner */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          openEditModal(server)
                        }}
                        className="absolute top-6 right-6 flex items-center gap-2 px-3 py-1.5 bg-blue-500/20 text-blue-400 border border-blue-500/40 rounded-lg hover:bg-blue-500/30 transition-all"
                      >
                        <Edit className="w-4 h-4" />
                        Edit
                      </button>

                      <div className="flex items-start justify-between mb-4 pr-24">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="text-lg font-bold text-white">{server.name}</h3>
                            {activeServerRentals.length > 0 && (
                              <span className="text-xs bg-neon-green/20 text-neon-green border border-neon-green/40 px-2 py-1 rounded-full">
                                Đang thuê: {activeServerRentals.length}
                              </span>
                            )}
                          </div>
                          {server.ip && (
                            <p className="text-xs text-gray-500 mb-2">IP: {server.ip}</p>
                          )}
                          <p className="text-sm text-gray-400 mb-3">{server.specifications || server.specs}</p>

                          {/* Server Info Grid */}
                          <div className="grid grid-cols-3 gap-3 mb-4">
                            <div>
                              <p className="text-xs text-gray-500">CPU Cores</p>
                              <p className="text-lg font-bold text-neon-yellow">{Number(server.cpu_cores) || 0}</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500">RAM</p>
                              <p className="text-lg font-bold text-neon-cyan">{Number(server.ram_gb) || 0}GB</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500">OS</p>
                              <p className="text-lg font-bold text-neon-purple">{server.os_type || 'Unknown'}</p>
                            </div>
                          </div>
                        </div>

                        {/* Price Display on Right */}
                        <div className="text-right">
                          <p className="text-xs text-gray-500 mb-1">Monthly Price</p>
                          <p className="text-xl font-bold text-neon-yellow">${Number(server.price_per_month || 0).toFixed(2)}</p>
                        </div>
                      </div>

                      {/* Server Metrics Display */}
                      <div className="bg-dark-900/50 rounded-lg p-4 mb-4 border border-neon-cyan/20 space-y-3">
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-xs text-gray-400">CPU Usage</p>
                            <span className="text-sm font-bold text-neon-yellow">
                              {serverMetrics.cpu !== null ? `${serverMetrics.cpu.toFixed(1)}%` : 'N/A'}
                            </span>
                          </div>
                          <div className="w-full bg-dark-800 rounded-full h-1.5">
                            <div
                              className="bg-neon-yellow h-1.5 rounded-full transition-all"
                              style={{ width: `${serverMetrics.cpu || 0}%` }}
                            ></div>
                          </div>
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-xs text-gray-400">Memory Usage</p>
                            <span className="text-sm font-bold text-neon-cyan">
                              {serverMetrics.memory !== null ? `${serverMetrics.memory.toFixed(1)}%` : 'N/A'}
                            </span>
                          </div>
                          <div className="w-full bg-dark-800 rounded-full h-1.5">
                            <div
                              className="bg-neon-cyan h-1.5 rounded-full transition-all"
                              style={{ width: `${serverMetrics.memory || 0}%` }}
                            ></div>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4 mb-4">
                      </div>

                      {/* Subscribers Button + Connection Status - Side by Side */}
                      <div className="flex items-center gap-3 mb-3">
                        {serverRentals.length > 0 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              openRentersModal(server)
                            }}
                            className="px-3 py-2 bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/60 rounded-lg hover:bg-neon-cyan/30 hover:border-neon-cyan transition-all font-semibold text-sm"
                          >
                            Người đang thuê ({activeServerRentals.length})
                          </button>
                        )}

                        {/* Subscribers Button - Compact */}
                        {(server.subscribers_count || 0) > 0 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              openSubscribersModal(server.id)
                            }}
                            className="px-3 py-2 bg-neon-green/20 text-neon-green border border-neon-green/60 rounded-lg hover:bg-neon-green/30 hover:border-neon-green transition-all font-semibold text-sm flex items-center gap-1.5"
                          >
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v2h8v-2zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-2a4 4 0 00-8 0v2a2 2 0 002 2h4a2 2 0 002-2z"></path>
                            </svg>
                            Subscribers ({server.subscribers_count || 0})
                          </button>
                        )}

                        {/* Connection Status */}
                        <div className="flex items-center gap-2">
                          {serverMetrics.cpu !== null ? (
                            <>
                              <div className="w-2 h-2 rounded-full bg-neon-green"></div>
                              <p className="text-sm font-semibold text-neon-green">Có kết nối</p>
                            </>
                          ) : (
                            <>
                              <div className="w-2 h-2 rounded-full bg-red-500"></div>
                              <p className="text-sm font-semibold text-red-400">Không có kết nối</p>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Request Badge */}
                      {serverRequests.length > 0 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedServerForRequests(server)
                            setShowRequestsModal(true)
                          }}
                          className="flex items-center gap-2 px-4 py-2 bg-yellow-500/20 text-yellow-400 border border-yellow-500/40 rounded-lg hover:bg-yellow-500/30 transition-all whitespace-nowrap"
                        >
                          <AlertCircle className="w-5 h-5" />
                          {serverRequests.length} Request{serverRequests.length !== 1 ? 's' : ''}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Requests Modal */}
          {showRequestsModal && selectedServerForRequests && (
            <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
              <div className="bg-dark-800 border border-neon-cyan/20 rounded-xl p-8 max-w-2xl w-full">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className="text-2xl font-bold text-white mb-1">
                      Requests for {selectedServerForRequests.name}
                    </h3>
                    <p className="text-sm text-gray-400">
                      {getRequestsForServer(selectedServerForRequests.id).length} pending request(s)
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setShowRequestsModal(false)
                      setSelectedServerForRequests(null)
                    }}
                    className="p-2 hover:bg-dark-700 rounded-lg transition-all"
                  >
                    <X className="w-6 h-6 text-gray-400" />
                  </button>
                </div>

                <div className="space-y-4 max-h-96 overflow-y-auto">
                  {getRequestsForServer(selectedServerForRequests.id).map((req) => (
                    <div
                      key={req.id}
                      className="bg-dark-900/50 border border-yellow-500/30 rounded-lg p-4"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <p className="text-white font-semibold">{req.user_name}</p>
                          <p className="text-xs text-gray-400">{req.user_email}</p>
                          <p className="text-xs text-gray-500 mt-1">
                            Requested: {formatVNDate(req.requested_at)}
                          </p>
                        </div>
                        <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-1 rounded">
                          Pending
                        </span>
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={() => approveRequest(req.id)}
                          disabled={processingRequest === req.id}
                          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-green-500/20 text-green-400 rounded hover:bg-green-500/30 transition-all disabled:opacity-50 text-sm"
                        >
                          <CheckCircle className="w-4 h-4" />
                          {processingRequest === req.id ? 'Approving...' : 'Approve'}
                        </button>
                        <button
                          onClick={() => rejectRequest(req.id)}
                          disabled={processingRequest === req.id}
                          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-all disabled:opacity-50 text-sm"
                        >
                          <XCircle className="w-4 h-4" />
                          {processingRequest === req.id ? 'Rejecting...' : 'Reject'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex gap-3 pt-6 border-t border-gray-700">
                  <button
                    onClick={() => {
                      setShowRequestsModal(false)
                      setSelectedServerForRequests(null)
                    }}
                    className="flex-1 px-4 py-2 bg-gray-700/20 text-gray-300 rounded hover:bg-gray-700/40 transition-all"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Edit Server Modal */}
          {showEditModal && selectedServerForEdit && (
            <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
              <div className="bg-dark-800 border border-neon-cyan/20 rounded-xl p-8 max-w-2xl w-full">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-2xl font-bold text-white">Edit Server</h3>
                  <button
                    onClick={closeEditModal}
                    className="p-2 hover:bg-dark-700 rounded-lg transition-all"
                  >
                    <X className="w-6 h-6 text-gray-400" />
                  </button>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Server Name</label>
                    <input
                      type="text"
                      value={editFormData.name || ''}
                      onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                      className="w-full px-4 py-2 bg-dark-900 border border-gray-700 rounded text-white focus:outline-none focus:border-neon-cyan"
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Specifications</label>
                    <input
                      type="text"
                      value={editFormData.specs || ''}
                      onChange={(e) => setEditFormData({ ...editFormData, specs: e.target.value })}
                      className="w-full px-4 py-2 bg-dark-900 border border-gray-700 rounded text-white focus:outline-none focus:border-neon-cyan"
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Price per Month (USD)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={editFormData.price_per_month || 0}
                      onChange={(e) => setEditFormData({ ...editFormData, price_per_month: parseFloat(e.target.value) })}
                      className="w-full px-4 py-2 bg-dark-900 border border-gray-700 rounded text-white focus:outline-none focus:border-neon-cyan"
                    />
                  </div>

                  {showEditHardwareLoading ? (
                    <div className="text-center py-4">
                      <p className="text-gray-400">Loading system information...</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-4 bg-dark-900 p-4 rounded-lg border border-gray-700">
                      <div>
                        <label className="block text-xs text-gray-500 mb-2">CPU Cores</label>
                        <p className="text-xl font-bold text-neon-yellow">{editHardwareInfo.cpu_cores}</p>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-2">RAM (GB)</label>
                        <p className="text-xl font-bold text-neon-cyan">{editHardwareInfo.ram_gb}</p>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-2">OS Type</label>
                        <p className="text-xl font-bold text-neon-purple">{editHardwareInfo.os_type}</p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex gap-3 pt-6 border-t border-gray-700">
                  <button
                    onClick={closeEditModal}
                    className="flex-1 px-4 py-2 bg-gray-700/20 text-gray-300 rounded hover:bg-gray-700/40 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveServerEdit}
                    disabled={updatingServer === selectedServerForEdit?.id}
                    className="flex-1 px-4 py-2 bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/40 rounded hover:bg-neon-cyan/30 transition-all disabled:opacity-50"
                  >
                    {updatingServer === selectedServerForEdit?.id ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Server Chart Modal */}
          {showServerChartModal && selectedServerForChart && (
            <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
              <div className="bg-dark-800 border border-neon-cyan/20 rounded-xl p-8 max-w-4xl w-full mx-4">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className="text-2xl font-bold text-white mb-1">{selectedServerForChart}</h3>
                    <p className="text-sm text-gray-400">Last 2 hours of system metrics</p>
                  </div>
                  <button
                    onClick={closeServerChartModal}
                    className="p-2 hover:bg-dark-700 rounded-lg transition-all"
                  >
                    <X className="w-6 h-6 text-gray-400" />
                  </button>
                </div>

                {serverChartLoading ? (
                  <div className="flex items-center justify-center h-96">
                    <p className="text-gray-400">Loading chart data...</p>
                  </div>
                ) : serverChartData.length > 0 ? (
                  <div className="space-y-6">
                    {/* CPU Statistics */}
                    <div className="grid grid-cols-3 gap-4">
                      <div className="bg-dark-900/50 border border-neon-yellow/30 rounded-lg p-4">
                        <p className="text-xs text-gray-400 mb-2">CPU Average</p>
                        <p className="text-2xl font-bold text-neon-yellow">
                          {serverCpuStats.average}
                          <span className="text-sm text-gray-400 ml-1">%</span>
                        </p>
                      </div>
                      <div className="bg-dark-900/50 border border-neon-green/30 rounded-lg p-4">
                        <p className="text-xs text-gray-400 mb-2">CPU Minimum</p>
                        <p className="text-2xl font-bold text-neon-green">
                          {serverCpuStats.min}
                          <span className="text-sm text-gray-400 ml-1">%</span>
                        </p>
                      </div>
                      <div className="bg-dark-900/50 border border-neon-orange/30 rounded-lg p-4">
                        <p className="text-xs text-gray-400 mb-2">CPU Maximum</p>
                        <p className="text-2xl font-bold text-neon-orange">
                          {serverCpuStats.max}
                          <span className="text-sm text-gray-400 ml-1">%</span>
                        </p>
                      </div>
                    </div>

                    {/* Memory Statistics */}
                    <div className="grid grid-cols-3 gap-4">
                      <div className="bg-dark-900/50 border border-neon-cyan/30 rounded-lg p-4">
                        <p className="text-xs text-gray-400 mb-2">Memory Average</p>
                        <p className="text-2xl font-bold text-neon-cyan">
                          {serverMemoryStats.average}
                          <span className="text-sm text-gray-400 ml-1">%</span>
                        </p>
                      </div>
                      <div className="bg-dark-900/50 border border-neon-green/30 rounded-lg p-4">
                        <p className="text-xs text-gray-400 mb-2">Memory Minimum</p>
                        <p className="text-2xl font-bold text-neon-green">
                          {serverMemoryStats.min}
                          <span className="text-sm text-gray-400 ml-1">%</span>
                        </p>
                      </div>
                      <div className="bg-dark-900/50 border border-neon-orange/30 rounded-lg p-4">
                        <p className="text-xs text-gray-400 mb-2">Memory Maximum</p>
                        <p className="text-2xl font-bold text-neon-orange">
                          {serverMemoryStats.max}
                          <span className="text-sm text-gray-400 ml-1">%</span>
                        </p>
                      </div>
                    </div>

                    {/* Chart */}
                    <div className="bg-dark-900/50 rounded-lg p-6 border border-gray-700">
                      <ResponsiveContainer width="100%" height={400}>
                        <LineChart data={serverChartData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                          <XAxis
                            dataKey="time"
                            stroke="#9CA3AF"
                            tick={{ fontSize: 12 }}
                          />
                          <YAxis
                            stroke="#9CA3AF"
                            tick={{ fontSize: 12 }}
                            label={{ value: '%', angle: -90, position: 'insideLeft' }}
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
                            dataKey="cpu"
                            stroke="#ffd700"
                            dot={false}
                            strokeWidth={2}
                            name="CPU %"
                          />
                          <Line
                            type="monotone"
                            dataKey="memory"
                            stroke="#00d4ff"
                            dot={false}
                            strokeWidth={2}
                            name="Memory %"
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
                    onClick={closeServerChartModal}
                    className="flex-1 px-4 py-2 bg-gray-700/20 text-gray-300 rounded hover:bg-gray-700/40 transition-all"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        /* USER VIEW */
        <>
          {/* User Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-dark-800 border border-neon-cyan/20 rounded-xl p-6">
              <p className="text-gray-400 text-sm mb-2">Available Servers</p>
              <p className="text-3xl font-bold text-neon-cyan">
                {(availableServers || []).filter((s) => !getRentalByServer(s.server_id || s.id)).length}
              </p>
            </div>
            <div className="bg-dark-800 border border-neon-green/20 rounded-xl p-6">
              <p className="text-gray-400 text-sm mb-2">My Subscriptions</p>
              <p className="text-3xl font-bold text-neon-green">{mySubscriptionsCount}</p>
            </div>
            <div className="bg-dark-800 border border-neon-purple/20 rounded-xl p-6">
              <p className="text-gray-400 text-sm mb-2">Monthly Cost</p>
              <p className="text-3xl font-bold text-neon-purple">
                ${myMonthlyCost.toFixed(2)}
              </p>
            </div>
          </div>

          <div className="border-b border-gray-700 flex items-center gap-8">
            <button
              onClick={() => setUserViewTab('store')}
              className={`pb-3 text-xl font-semibold transition-all ${
                userViewTab === 'store'
                  ? 'text-neon-cyan border-b-2 border-neon-cyan'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Cửa hàng
            </button>
            <button
              onClick={() => setUserViewTab('mine')}
              className={`pb-3 text-xl font-semibold transition-all ${
                userViewTab === 'mine'
                  ? 'text-neon-cyan border-b-2 border-neon-cyan'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Server của tôi ({mySubscriptionsCount})
            </button>
          </div>

          {/* Servers Grid */}
          {userViewTab === 'store' && (loading ? (
            <div className="text-center py-16">
              <p className="text-gray-400">Loading servers...</p>
            </div>
          ) : (() => {
            // Ensure availableServers is an array
            const serversToDisplay = Array.isArray(availableServers) ? availableServers : []
            
            if (serversToDisplay.length === 0) {
              return (
                <div className="text-center py-16">
                  <Server className="w-16 h-16 text-gray-600 mx-auto mb-4 opacity-50" />
                  <h3 className="text-xl font-semibold text-white mb-2">No Servers Available</h3>
                  <p className="text-gray-400">
                    {isAdmin ? 'Create a server' : 'Contact admin for available servers'}
                  </p>
                </div>
              )
            }

            // Show all servers in store; connectivity is displayed per-card.
            const filteredServers = serversToDisplay.filter(server => {
              const myRental = getRentalByServer(server.server_id || server.id)
              return !myRental
            })
            
            if (filteredServers.length === 0) {
              return (
                <div className="text-center py-16">
                  <Server className="w-16 h-16 text-gray-600 mx-auto mb-4 opacity-50" />
                  <h3 className="text-xl font-semibold text-white mb-2">No Active Servers</h3>
                  <p className="text-gray-400">No servers are currently online</p>
                </div>
              )
            }

            return (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredServers.map((server, idx) => (
                  <ServerCard key={server.id} server={server} index={idx} />
                ))}
              </div>
            )
          })())}

          {/* Chart Modal */}
          {showChartModal && (
            <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
              <div className="bg-dark-800 border border-neon-cyan/20 rounded-xl p-8 max-w-4xl w-full mx-4">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className="text-2xl font-bold text-white mb-1">Server 1</h3>
                    <p className="text-sm text-gray-400">Last 2 hours of system metrics</p>
                  </div>
                  <button
                    onClick={() => handleCloseChart()}
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
                    {/* CPU Statistics */}
                    <div className="grid grid-cols-3 gap-4">
                      <div className="bg-dark-900/50 border border-neon-yellow/30 rounded-lg p-4">
                        <p className="text-xs text-gray-400 mb-2">CPU Average</p>
                        <p className="text-2xl font-bold text-neon-yellow">
                          {cpuStats.average}
                          <span className="text-sm text-gray-400 ml-1">%</span>
                        </p>
                      </div>
                      <div className="bg-dark-900/50 border border-neon-green/30 rounded-lg p-4">
                        <p className="text-xs text-gray-400 mb-2">CPU Minimum</p>
                        <p className="text-2xl font-bold text-neon-green">
                          {cpuStats.min}
                          <span className="text-sm text-gray-400 ml-1">%</span>
                        </p>
                      </div>
                      <div className="bg-dark-900/50 border border-neon-orange/30 rounded-lg p-4">
                        <p className="text-xs text-gray-400 mb-2">CPU Maximum</p>
                        <p className="text-2xl font-bold text-neon-orange">
                          {cpuStats.max}
                          <span className="text-sm text-gray-400 ml-1">%</span>
                        </p>
                      </div>
                    </div>

                    {/* Memory Statistics */}
                    <div className="grid grid-cols-3 gap-4">
                      <div className="bg-dark-900/50 border border-neon-cyan/30 rounded-lg p-4">
                        <p className="text-xs text-gray-400 mb-2">Memory Average</p>
                        <p className="text-2xl font-bold text-neon-cyan">
                          {memoryStats.average}
                          <span className="text-sm text-gray-400 ml-1">%</span>
                        </p>
                      </div>
                      <div className="bg-dark-900/50 border border-neon-green/30 rounded-lg p-4">
                        <p className="text-xs text-gray-400 mb-2">Memory Minimum</p>
                        <p className="text-2xl font-bold text-neon-green">
                          {memoryStats.min}
                          <span className="text-sm text-gray-400 ml-1">%</span>
                        </p>
                      </div>
                      <div className="bg-dark-900/50 border border-neon-orange/30 rounded-lg p-4">
                        <p className="text-xs text-gray-400 mb-2">Memory Maximum</p>
                        <p className="text-2xl font-bold text-neon-orange">
                          {memoryStats.max}
                          <span className="text-sm text-gray-400 ml-1">%</span>
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
                            label={{ value: '%', angle: -90, position: 'insideLeft' }}
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
                            dataKey="cpu"
                            stroke="#ffd700"
                            dot={false}
                            strokeWidth={2}
                            name="CPU %"
                          />
                          <Line
                            type="monotone"
                            dataKey="memory"
                            stroke="#00d4ff"
                            dot={false}
                            strokeWidth={2}
                            name="Memory %"
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
                    onClick={() => handleCloseChart()}
                    className="flex-1 px-4 py-2 bg-gray-700/20 text-gray-300 rounded hover:bg-gray-700/40 transition-all"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Server Chart Modal (for rented servers - user view) */}
          {showServerChartModal && selectedServerForChart && (
            <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
              <div className="bg-dark-800 border border-neon-cyan/20 rounded-xl p-8 max-w-4xl w-full mx-4">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className="text-2xl font-bold text-white mb-1">{selectedServerForChart}</h3>
                    <p className="text-sm text-gray-400">Last 2 hours of system metrics</p>
                  </div>
                  <button
                    onClick={closeServerChartModal}
                    className="p-2 hover:bg-dark-700 rounded-lg transition-all"
                  >
                    <X className="w-6 h-6 text-gray-400" />
                  </button>
                </div>

                {serverChartLoading ? (
                  <div className="flex items-center justify-center h-96">
                    <p className="text-gray-400">Loading chart data...</p>
                  </div>
                ) : serverChartData.length > 0 ? (
                  <div className="space-y-6">
                    <div className="grid grid-cols-3 gap-4">
                      <div className="bg-dark-900/50 border border-neon-yellow/30 rounded-lg p-4">
                        <p className="text-xs text-gray-400 mb-2">CPU Average</p>
                        <p className="text-2xl font-bold text-neon-yellow">
                          {serverCpuStats.average}
                          <span className="text-sm text-gray-400 ml-1">%</span>
                        </p>
                      </div>
                      <div className="bg-dark-900/50 border border-neon-green/30 rounded-lg p-4">
                        <p className="text-xs text-gray-400 mb-2">CPU Minimum</p>
                        <p className="text-2xl font-bold text-neon-green">
                          {serverCpuStats.min}
                          <span className="text-sm text-gray-400 ml-1">%</span>
                        </p>
                      </div>
                      <div className="bg-dark-900/50 border border-neon-orange/30 rounded-lg p-4">
                        <p className="text-xs text-gray-400 mb-2">CPU Maximum</p>
                        <p className="text-2xl font-bold text-neon-orange">
                          {serverCpuStats.max}
                          <span className="text-sm text-gray-400 ml-1">%</span>
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div className="bg-dark-900/50 border border-neon-cyan/30 rounded-lg p-4">
                        <p className="text-xs text-gray-400 mb-2">Memory Average</p>
                        <p className="text-2xl font-bold text-neon-cyan">
                          {serverMemoryStats.average}
                          <span className="text-sm text-gray-400 ml-1">%</span>
                        </p>
                      </div>
                      <div className="bg-dark-900/50 border border-neon-green/30 rounded-lg p-4">
                        <p className="text-xs text-gray-400 mb-2">Memory Minimum</p>
                        <p className="text-2xl font-bold text-neon-green">
                          {serverMemoryStats.min}
                          <span className="text-sm text-gray-400 ml-1">%</span>
                        </p>
                      </div>
                      <div className="bg-dark-900/50 border border-neon-orange/30 rounded-lg p-4">
                        <p className="text-xs text-gray-400 mb-2">Memory Maximum</p>
                        <p className="text-2xl font-bold text-neon-orange">
                          {serverMemoryStats.max}
                          <span className="text-sm text-gray-400 ml-1">%</span>
                        </p>
                      </div>
                    </div>

                    <div className="bg-dark-900/50 rounded-lg p-6 border border-gray-700">
                      <ResponsiveContainer width="100%" height={400}>
                        <LineChart data={serverChartData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                          <XAxis dataKey="time" stroke="#9CA3AF" tick={{ fontSize: 12 }} />
                          <YAxis stroke="#9CA3AF" tick={{ fontSize: 12 }} label={{ value: '%', angle: -90, position: 'insideLeft' }} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: '#1a1a2e',
                              border: '1px solid #00d4ff',
                              borderRadius: '8px',
                            }}
                            labelStyle={{ color: '#fff' }}
                          />
                          <Legend />
                          <Line type="monotone" dataKey="cpu" stroke="#ffd700" dot={false} strokeWidth={2} name="CPU %" />
                          <Line type="monotone" dataKey="memory" stroke="#00d4ff" dot={false} strokeWidth={2} name="Memory %" />
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
                    onClick={closeServerChartModal}
                    className="flex-1 px-4 py-2 bg-gray-700/20 text-gray-300 rounded hover:bg-gray-700/40 transition-all"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}

          {userViewTab === 'mine' && myRentedServerCards.length > 0 && (
            <div className="mt-10">
              <h2 className="text-2xl font-bold text-white mb-6">Server của tôi</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {myRentedServerCards.map((server, idx) => (
                  <ServerCard key={`${server.server_id || server.id}-mine`} server={server} index={idx} />
                ))}
              </div>
            </div>
          )}

          {userViewTab === 'mine' && myRentedServerCards.length === 0 && (
            <div className="mt-10 text-center py-16 border border-gray-700 rounded-xl bg-dark-800/40">
              <h3 className="text-xl font-semibold text-white mb-2">Bạn chưa thuê server nào</h3>
              <p className="text-gray-400">Chuyển qua tab Cửa hàng để chọn server cần thuê.</p>
            </div>
          )}

          {/* Subscription Requests Section */}
          {userViewTab === 'mine' && userRequests.length > 0 && (
            <div className="mt-16 border-t border-gray-700 pt-8">
              <h2 className="text-2xl font-bold text-white mb-6">Your Subscription Requests</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {userRequests.map((req) => (
                  <div
                    key={req.id}
                    className={`rounded-xl p-6 border ${
                      req.status === 'pending'
                        ? 'bg-yellow-500/10 border-yellow-500/30'
                        : req.status === 'approved'
                        ? 'bg-green-500/10 border-green-500/30'
                        : 'bg-red-500/10 border-red-500/30'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h3 className="text-lg font-bold text-white">{req.server_name}</h3>
                        <p className="text-xs text-gray-400 mt-1">{req.server_specs}</p>
                      </div>
                      <span
                        className={`text-xs px-3 py-1 rounded-full font-semibold ${
                          req.status === 'pending'
                            ? 'bg-yellow-500/20 text-yellow-400'
                            : req.status === 'approved'
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-red-500/20 text-red-400'
                        }`}
                      >
                        {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                      </span>
                    </div>

                    <div className="space-y-2 text-sm text-gray-400">
                      <p>
                        <span className="text-gray-500">Requested:</span>{' '}
                        {formatVNDate(req.requested_at)}
                      </p>
                      {req.approved_at && (
                        <p>
                          <span className="text-gray-500">Approved:</span>{' '}
                          {formatVNDate(req.approved_at)}
                        </p>
                      )}
                      {req.rejection_reason && (
                        <p className="text-red-300">
                          <span className="text-red-400">Reason:</span> {req.rejection_reason}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Subscription Duration Modal */}
      {rentModal.open && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-dark-800 border border-neon-cyan/40 rounded-xl p-8 max-w-md w-full mx-4">
            <h2 className="text-2xl font-bold text-neon-cyan mb-2">
              {rentModal.action === 'rent' ? 'Xác nhận thuê server' : rentModal.action === 'download_key' ? 'Xác nhận tải private key' : 'Xác nhận hủy đăng ký'}
            </h2>
            <p className="text-gray-400 mb-2">Mã bảo mật: <span className="text-neon-yellow font-bold">{rentModal.code}</span></p>
            <p className="text-gray-500 mb-6">
              {rentModal.action === 'rent' ? 'Nhập đúng 6 số để hoàn tất thuê server.' : rentModal.action === 'download_key' ? 'Nhập đúng 6 số để tải lại private key.' : 'Nhập đúng 6 số để xác nhận hủy đăng ký server.'}
            </p>
            <div className="mb-4">
              <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
                <span>Thời gian nhập mã</span>
                <span>{rentTimeLeft}s</span>
              </div>
              <div className="w-full h-2 bg-dark-900 rounded-full overflow-hidden">
                <div
                  className="h-full bg-neon-cyan transition-all duration-1000"
                  style={{ width: `${(rentTimeLeft / RENT_CODE_TIMEOUT_SECONDS) * 100}%` }}
                />
              </div>
            </div>
            <div className="flex gap-2 mb-6">
              {rentCodeInputs.map((digit, idx) => (
                <input
                  key={idx}
                  ref={(el) => (rentInputRefs.current[idx] = el)}
                  value={digit}
                  onChange={(e) => handleCodeInputChange(idx, e.target.value)}
                  onKeyDown={(e) => handleCodeKeyDown(idx, e)}
                  onPaste={(e) => {
                    const pasted = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6)
                    if (!pasted) return
                    e.preventDefault()
                    const next = ['','','','','','']
                    pasted.split('').forEach((ch, i) => { next[i] = ch })
                    setRentCodeInputs(next)
                    const nextIndex = Math.min(pasted.length, 5)
                    rentInputRefs.current[nextIndex]?.focus()
                  }}
                  maxLength={1}
                  className="w-10 h-12 text-center bg-dark-900 border border-neon-cyan/40 rounded text-white text-xl"
                />
              ))}
            </div>
            <div className="flex gap-3">
              <button
                onClick={closeRentModal}
                className="flex-1 px-4 py-3 rounded-lg bg-gray-700/20 text-gray-300 hover:bg-gray-700/40 transition-all font-semibold"
              >
                Hủy
              </button>
              <button
                onClick={confirmCodeAction}
                disabled={rentActionLoading || rentCodeInputs.join('').length !== 6}
                className="flex-1 px-4 py-3 rounded-lg bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/40 hover:border-neon-cyan transition-all font-semibold disabled:opacity-50"
              >
                {rentActionLoading ? 'Đang xử lý...' : 'Xác nhận'}
              </button>
            </div>
          </div>
        </div>
      )}

      {rentalDetailModal.open && rentalDetailModal.rental && (() => {
        const rental = rentalDetailModal.rental
        const privateKeyFile = rental.private_key_filename || 'key.pem'
        const keyVarCmd = `$key = "${privateKeyFile}"`
        const fixCmd1 = `icacls $key /inheritance:r`
        const fixCmd2 = `icacls $key /remove "HUU\\CodexSandboxUsers" "NT AUTHORITY\\Authenticated Users" "BUILTIN\\Users" "Everyone"`
        const fixCmd3 = `icacls $key /grant:r "$($env:USERNAME):R"`
        const sshCmd = `ssh -i "$env:USERPROFILE\\Downloads\\${privateKeyFile}" ${rental.username}@${rental.ip}`
        return (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
            <div className="bg-dark-800 border border-neon-cyan/40 rounded-xl p-8 max-w-2xl w-full mx-4">
              <h2 className="text-2xl font-bold text-neon-cyan mb-4">Chi tiết server đang thuê</h2>
              <div className="space-y-3 text-gray-200">
                <div className="flex items-center gap-2">
                  <p>IP: {rental.ip}</p>
                  <button
                    onClick={() => copyToClipboard(String(rental.ip || ''), 'ip')}
                    className="px-2 py-1 text-xs rounded bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/40"
                  >
                    Copy
                  </button>
                </div>
                <p>Port: {rental.port || 22}</p>
                <div className="flex items-center gap-2">
                  <p>Username: {rental.username}</p>
                  <button
                    onClick={() => copyToClipboard(String(rental.username || ''), 'username')}
                    className="px-2 py-1 text-xs rounded bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/40"
                  >
                    Copy
                  </button>
                </div>
                <p>SSH: {rental.ssh_command || `ssh -i "${privateKeyFile}" ${rental.username}@${rental.ip}`}</p>
                <p className="text-neon-yellow font-semibold mt-4">Hướng dẫn SSH (Windows)</p>
                <p>Nếu gặp lỗi "UNPROTECTED PRIVATE KEY FILE", chạy lệnh dưới trong PowerShell:</p>
                <div className="mt-2 p-3 rounded bg-[#101a3a] border border-neon-cyan/30 space-y-2">
                  <div className="flex items-center gap-2">
                    <code className="text-xs text-gray-300 break-all flex-1">{keyVarCmd}</code>
                    <button
                      onClick={() => copyToClipboard(keyVarCmd, 'cmd-key')}
                      className={`p-2 rounded border transition-colors ${copiedKey === 'cmd-key' ? 'bg-neon-green/20 text-neon-green border-neon-green/40' : 'bg-neon-cyan/20 text-neon-cyan border-neon-cyan/40'}`}
                      title="Copy"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="text-xs text-gray-300 break-all flex-1">{fixCmd1}</code>
                    <button
                      onClick={() => copyToClipboard(fixCmd1, 'cmd-1')}
                      className={`p-2 rounded border transition-colors ${copiedKey === 'cmd-1' ? 'bg-neon-green/20 text-neon-green border-neon-green/40' : 'bg-neon-cyan/20 text-neon-cyan border-neon-cyan/40'}`}
                      title="Copy"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="text-xs text-gray-300 break-all flex-1">{fixCmd2}</code>
                    <button
                      onClick={() => copyToClipboard(fixCmd2, 'cmd-2')}
                      className={`p-2 rounded border transition-colors ${copiedKey === 'cmd-2' ? 'bg-neon-green/20 text-neon-green border-neon-green/40' : 'bg-neon-cyan/20 text-neon-cyan border-neon-cyan/40'}`}
                      title="Copy"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="text-xs text-gray-300 break-all flex-1">{fixCmd3}</code>
                    <button
                      onClick={() => copyToClipboard(fixCmd3, 'cmd-3')}
                      className={`p-2 rounded border transition-colors ${copiedKey === 'cmd-3' ? 'bg-neon-green/20 text-neon-green border-neon-green/40' : 'bg-neon-cyan/20 text-neon-cyan border-neon-cyan/40'}`}
                      title="Copy"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="text-xs text-gray-300 break-all flex-1">{sshCmd}</code>
                    <button
                      onClick={() => copyToClipboard(sshCmd, 'cmd-ssh')}
                      className={`p-2 rounded border transition-colors ${copiedKey === 'cmd-ssh' ? 'bg-neon-green/20 text-neon-green border-neon-green/40' : 'bg-neon-cyan/20 text-neon-cyan border-neon-cyan/40'}`}
                      title="Copy"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
              <div className="mt-6 flex justify-end">
                <button
                  onClick={() => setRentalDetailModal({ open: false, rental: null })}
                  className="px-4 py-2 rounded bg-gray-700/30 text-gray-200 border border-gray-600"
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Subscription Duration Modal */}
      {showDurationModal && selectedServerForDuration && (() => {
        const selectedServer = allServers.find(s => s.id === selectedServerForDuration)
        if (!selectedServer) return null
        
        const pricePerMonth = Number(selectedServer.price_per_month || 0)
        
        const getDiscountedPrice = (months) => {
          const discounts = { 1: 0, 3: 0.1, 6: 0.2, 12: 0.3 }
          const discount = discounts[months] || 0
          const totalPrice = pricePerMonth * months
          return {
            originalPrice: totalPrice,
            discount: discount * 100,
            finalPrice: totalPrice * (1 - discount)
          }
        }

        return (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
            <div className="bg-dark-800 border border-neon-cyan/40 rounded-xl p-8 max-w-md w-full mx-4">
              <h2 className="text-2xl font-bold text-neon-cyan mb-2">Select Subscription Duration</h2>
              <p className="text-gray-400 mb-6">Price: <span className="text-neon-yellow font-semibold">${pricePerMonth.toFixed(2)}</span>/month</p>

              <div className="space-y-3 mb-8">
                {[
                  { months: 1, label: '1 Month' },
                  { months: 3, label: '3 Months' },
                  { months: 6, label: '6 Months' },
                  { months: 12, label: '1 Year' }
                ].map((option) => {
                  const { finalPrice, discount } = getDiscountedPrice(option.months)
                  return (
                    <button
                      key={option.months}
                      onClick={() => setSelectedDuration(option.months)}
                      className={`w-full p-4 rounded-lg border-2 transition-all text-left ${
                        selectedDuration === option.months
                          ? 'border-neon-cyan bg-neon-cyan/10'
                          : 'border-gray-700 bg-dark-900 hover:border-gray-600'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-white">{option.label}</p>
                          <div className="flex items-center gap-3 mt-2">
                            {discount > 0 ? (
                              <>
                                <p className="text-sm line-through text-gray-500">${(pricePerMonth * option.months).toFixed(2)}</p>
                                <span className="text-xs text-white font-semibold bg-neon-red/80 px-2 py-1 rounded">
                                  -{discount.toFixed(0)}%
                                </span>
                                <p className="text-lg text-neon-green font-bold">${finalPrice.toFixed(2)}</p>
                              </>
                            ) : (
                              <p className="text-lg text-neon-yellow font-bold">${finalPrice.toFixed(2)}</p>
                            )}
                          </div>
                        </div>
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                          selectedDuration === option.months
                            ? 'border-neon-cyan bg-neon-cyan'
                            : 'border-gray-600'
                        }`}>
                          {selectedDuration === option.months && (
                            <div className="w-2 h-2 bg-dark-800 rounded-full"></div>
                          )}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowDurationModal(false)}
                  className="flex-1 px-4 py-3 rounded-lg bg-gray-700/20 text-gray-300 hover:bg-gray-700/40 transition-all font-semibold"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmSubscription}
                  className="flex-1 px-4 py-3 rounded-lg bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/40 hover:border-neon-cyan transition-all font-semibold"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Subscribers List Modal */}
      {showSubscribersModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-dark-800 border border-neon-green/40 rounded-xl p-8 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-neon-green">Server Subscribers</h2>
              <button
                onClick={closeSubscribersModal}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {loadingSubscribers ? (
              <div className="text-center py-12">
                <p className="text-gray-400">Loading subscribers...</p>
              </div>
            ) : subscribersList.length > 0 ? (
              <div className="space-y-3">
                {subscribersList.map((subscriber, index) => (
                  <div key={index} className="bg-dark-900 border border-gray-700/50 rounded-lg p-4 hover:border-neon-green/50 transition-all">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <p className="font-semibold text-white">{subscriber.renter_name || subscriber.username || 'Unknown'}</p>
                        <p className="text-sm text-gray-400">{subscriber.username || '-'}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-500 mb-1">Created</p>
                        <p className="text-sm text-neon-green font-semibold">
                          {formatVNDate(subscriber.created_at)}
                        </p>
                      </div>
                    </div>
                    {subscriber.status && (
                      <div className="mt-3 pt-3 border-t border-gray-700/50">
                        <p className="text-xs text-gray-500">Status: <span className="text-neon-yellow">{subscriber.status}</span></p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <p className="text-gray-400">Không có subscriber nào</p>
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={closeSubscribersModal}
                className="px-6 py-2 rounded-lg bg-gray-700/20 text-gray-300 hover:bg-gray-700/40 transition-all font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Renters List Modal */}
      {showRentersModal && selectedServerForRenters && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-dark-800 border border-neon-cyan/20 rounded-xl p-8 max-w-3xl w-full">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold text-neon-cyan">Người thuê server</h2>
                <p className="text-sm text-gray-400 mt-1">
                  {(() => {
                    const rentals = getRentalsForServer(selectedServerForRenters.id)
                    const active = rentals.filter((r) => ['creating', 'active', 'cancelling'].includes(r.status)).length
                    return `${selectedServerForRenters.name} - Đang thuê: ${active}, Tổng lịch sử: ${rentals.length}`
                  })()}
                </p>
              </div>
              <button
                onClick={closeRentersModal}
                className="p-2 hover:bg-dark-700 rounded-lg transition-all"
              >
                <X className="w-6 h-6 text-gray-400" />
              </button>
            </div>

            <div className="space-y-3 max-h-96 overflow-y-auto">
              {getRentalsForServer(selectedServerForRenters.id).map((rental) => (
                <div key={rental.rental_id} className="bg-dark-900/60 border border-neon-cyan/20 rounded-lg p-4">
                  {(() => {
                    const renterDisplay = rental.renter_name && String(rental.renter_name).trim()
                      ? rental.renter_name
                      : 'Chưa có dữ liệu user thuê'
                    return (
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs text-gray-400 mt-1">User thuê: {renterDisplay}</p>
                      <p className="text-xs text-gray-400 mt-1">Username VPS: {rental.username || '-'}</p>
                      <p className="text-xs text-gray-500 mt-1">Created: {formatVNDate(rental.created_at)}</p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span
                        className={`text-xs px-2 py-1 rounded-full ${
                          rental.status === 'active'
                            ? 'bg-green-500/20 text-green-400'
                            : rental.status === 'creating' || rental.status === 'cancelling'
                              ? 'bg-yellow-500/20 text-yellow-400'
                              : rental.status === 'cancelled'
                                ? 'bg-gray-500/20 text-gray-300'
                                : 'bg-red-500/20 text-red-300'
                        }`}
                      >
                        {rental.status}
                      </span>
                      {['active', 'creating'].includes(rental.status) && (
                        <button
                          onClick={() => {
                            closeRentersModal()
                            requestCancelRental(rental.rental_id)
                          }}
                          className="px-3 py-1.5 rounded bg-red-500/20 text-red-300 border border-red-500/40 hover:bg-red-500/30 transition-all text-xs font-semibold"
                        >
                          Hủy thuê
                        </button>
                      )}
                    </div>
                  </div>
                    )
                  })()}
                </div>
              ))}
              {getRentalsForServer(selectedServerForRenters.id).length === 0 && (
                <p className="text-gray-400 text-center py-6">Chưa có dữ liệu người thuê.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}






