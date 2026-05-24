import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Calendar, Plus, Server, Sparkles, Thermometer, TrendingUp } from 'lucide-react'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useDevices } from '../context/DeviceContext'
import { useAuth } from '../context/AuthContext'
import AddDeviceModal from './AddDeviceModal'
import api from '../api'
import { getVNDateInputValue } from '../utils/vnTime'

const DAY_MS = 24 * 60 * 60 * 1000
const IOT_TYPES = new Set(['temperature', 'humidity', 'soil_moisture', 'light_intensity', 'pressure'])
const ACTUAL_COLOR = '#fb7185'
const FORECAST_COLOR = '#facc15'

const getMetricUnit = (metricType) => ({
  temperature: 'C',
  humidity: '%',
  soil_moisture: '%',
  light_intensity: 'lux',
  pressure: 'hPa',
}[metricType] || '')

const pad = (value) => String(value).padStart(2, '0')

const formatDateHourLabel = (value) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${pad(date.getHours())}:00`
}

const formatDateBucket = (value) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`
}

const formatDateTimeText = (value) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${pad(date.getHours())}:00`
}

const startOfDay = (value) => {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

const endOfDay = (value) => {
  const date = new Date(value)
  date.setHours(23, 59, 59, 999)
  return date
}

const floorToHour = (value) => {
  const date = new Date(value)
  date.setMinutes(0, 0, 0)
  return date
}

const describeMethod = (method) => {
  if (method === 'open_meteo_location_forecast') return 'Weather forecast'
  if (method === 'tft_checkpoint') return 'Trained TFT model'
  if (method === 'tft_seasonal_baseline') return 'Smart fallback forecast'
  return 'Forecast model'
}

const describeSource = (source) => {
  const value = String(source || '').toLowerCase()
  if (value.includes('open_meteo')) return 'Live outdoor weather'
  if (value.includes('meteostat') || value.includes('weather')) return 'Historical weather cache'
  if (value.includes('metrics')) return 'Realtime sensor history'
  return 'Mixed input data'
}

const isValidDateText = (value) => {
  if (!value) return false
  const date = new Date(`${value}T00:00:00`)
  return !Number.isNaN(date.getTime())
}

const getForecastRange = (fromDate, toDate) => {
  const from = new Date(`${fromDate}T00:00:00`)
  const to = new Date(`${toDate}T00:00:00`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null
  return Math.floor((to - from) / DAY_MS) + 1
}

const buildTimelineBuckets = (fromDate, toDate, isOneDay) => {
  const from = startOfDay(`${fromDate}T00:00:00`)
  const to = startOfDay(`${toDate}T00:00:00`)
  const buckets = []

  if (isOneDay) {
    for (let hour = 0; hour < 24; hour += 1) {
      const timestamp = new Date(from)
      timestamp.setHours(hour, 0, 0, 0)
      buckets.push({
        key: timestamp.toISOString(),
        timestamp: timestamp.getTime(),
        label: formatDateHourLabel(timestamp),
        isFuture: timestamp.getTime() > floorToHour(new Date()).getTime(),
      })
    }
    return buckets
  }

  for (let cursor = new Date(from); cursor <= to; cursor = new Date(cursor.getTime() + DAY_MS)) {
    const bucketDate = startOfDay(cursor)
    buckets.push({
      key: bucketDate.toISOString(),
      timestamp: bucketDate.getTime(),
      label: formatDateBucket(bucketDate),
      isFuture: bucketDate.getTime() > startOfDay(new Date()).getTime(),
    })
  }
  return buckets
}

const buildSeriesMap = (rows, isOneDay, valueSelector) => {
  const buckets = new Map()

  for (const row of rows || []) {
    const rawTimestamp = row?.event_ts ?? row?.timestamp
    const date = new Date(rawTimestamp)
    const value = Number(valueSelector(row))
    if (Number.isNaN(date.getTime()) || Number.isNaN(value)) continue

    const bucketDate = isOneDay ? floorToHour(date) : startOfDay(date)
    const key = bucketDate.toISOString()
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(value)
  }

  return new Map(
    Array.from(buckets.entries()).map(([key, values]) => [
      key,
      Number((values.reduce((sum, item) => sum + item, 0) / values.length).toFixed(2)),
    ]),
  )
}

const buildChartData = ({ fromDate, toDate, historyMetrics, predictions }) => {
  const range = getForecastRange(fromDate, toDate)
  const isOneDay = range === 1
  const actualMap = buildSeriesMap(historyMetrics, isOneDay, (row) => row?.metric_value ?? row?.value)
  const forecastMap = buildSeriesMap(predictions, isOneDay, (row) => row?.predicted_value ?? row?.predictedValue)

  return buildTimelineBuckets(fromDate, toDate, isOneDay).map((bucket) => ({
    ...bucket,
    actualValue: bucket.isFuture ? null : actualMap.get(bucket.key) ?? null,
    forecastValue: bucket.isFuture ? forecastMap.get(bucket.key) ?? null : null,
  }))
}

const humanizeDatasetError = (message) => {
  const text = String(message || '')
  if (text.includes('No weather cache found')) {
    return 'Thiết bị này chưa có dữ liệu thời tiết để huấn luyện mô hình. Bạn chỉ cần bấm "Train Model", hệ thống sẽ tự đồng bộ trước khi train.'
  }
  if (text.includes('Target column')) {
    return 'Nguồn dữ liệu hiện tại chưa đủ giá trị hợp lệ để huấn luyện mô hình cho cảm biến này.'
  }
  if (text.includes('Not enough rows')) {
    return 'Thiết bị chưa có đủ dữ liệu lịch sử để huấn luyện dự báo dài ngày.'
  }
  return text || 'Chưa thể đọc trạng thái bộ dữ liệu cho thiết bị này.'
}

const humanizeFallbackReason = (message) => {
  const text = String(message || '')
  if (!text) return ''
  if (text.includes('No TFT metadata found')) {
    return 'Thiết bị chưa có model TFT đã huấn luyện, nên hệ thống đang dùng dự báo tạm thời.'
  }
  if (text.includes('No weather cache found')) {
    return 'Chưa có weather cache nên hệ thống đang dùng dự báo tạm từ dữ liệu cảm biến hiện có.'
  }
  return text
}

const humanizeFetchError = (error) => {
  const detail = error?.response?.data?.detail?.message || error?.response?.data?.detail || error?.message
  const text = String(detail || '')
  if (text.toLowerCase().includes('timeout')) {
    return 'Du bao dang phan hoi cham hon binh thuong. Du lieu thuc te van co the xem duoc, con phan forecast se thu lai o lan tai tiep theo.'
  }
  if (text.includes('IoT device not found')) {
    return 'Không tìm thấy thiết bị để dựng dự báo.'
  }
  return text || 'Không thể tải dữ liệu dự báo cho khoảng ngày này.'
}

export default function UserDashboard() {
  const { iotDevices: devices, myServers: servers, createIoTDevice } = useDevices()
  const { user } = useAuth()
  const inactiveStatuses = new Set(['cancelled', 'canceled', 'terminated', 'expired', 'inactive'])
  const activeServers = (servers || []).filter((s) => !inactiveStatuses.has(String(s?.status || '').toLowerCase()))

  const [showAddDeviceModal, setShowAddDeviceModal] = useState(false)
  const [addingDevice, setAddingDevice] = useState(false)
  const [selectedDeviceId, setSelectedDeviceId] = useState(null)
  const [fromDate, setFromDate] = useState(() => getVNDateInputValue())
  const [toDate, setToDate] = useState(getVNDateInputValue())
  const [chartData, setChartData] = useState([])
  const [loading, setLoading] = useState(false)
  const [validationError, setValidationError] = useState('')
  const [fetchError, setFetchError] = useState('')
  const [forecastInfo, setForecastInfo] = useState(null)
  const [forecastRefreshKey, setForecastRefreshKey] = useState(0)
  const [datasetStatus, setDatasetStatus] = useState(null)
  const [datasetStatusLoading, setDatasetStatusLoading] = useState(false)
  const [trainLoading, setTrainLoading] = useState(false)
  const [trainMessage, setTrainMessage] = useState('')
  const [trainError, setTrainError] = useState('')
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false)

  const selectedDevice = devices?.find((d) => d.id === selectedDeviceId) || devices?.[0]
  const selectedRange = useMemo(() => getForecastRange(fromDate, toDate), [fromDate, toDate])

  const chartSummary = useMemo(() => {
    const actualPoints = chartData.filter((point) => point.actualValue !== null).length
    const forecastPoints = chartData.filter((point) => point.forecastValue !== null).length
    return {
      actualPoints,
      forecastPoints,
      totalPoints: chartData.length,
      modeLabel: selectedRange === 1 ? '24 mốc theo giờ' : `${selectedRange || 0} mốc theo ngày`,
    }
  }, [chartData, selectedRange])

  const trendIsUp = useMemo(() => {
    const delta = Number(forecastInfo?.forecastDelta)
    if (Number.isNaN(delta)) return false
    return delta > 0
  }, [forecastInfo])

  useEffect(() => {
    if (devices?.length > 0 && !selectedDeviceId) setSelectedDeviceId(devices[0].id)
  }, [devices, selectedDeviceId])

  useEffect(() => {
    if (!selectedDevice) {
      setDatasetStatus(null)
      return
    }

    const fetchDatasetStatus = async () => {
      try {
        setDatasetStatusLoading(true)
        setTrainError('')
        const response = await api.get(`/api/model/tft-training/devices/${selectedDevice.id}/status`)
        setDatasetStatus(response?.data?.dataset || null)
      } catch (err) {
        const detail = err?.response?.data?.detail
        const message = typeof detail === 'string' ? detail : detail?.message
        setDatasetStatus({ error: humanizeDatasetError(message) })
      } finally {
        setDatasetStatusLoading(false)
      }
    }

    fetchDatasetStatus()
  }, [selectedDevice])

  useEffect(() => {
    if (!selectedDevice) return

    if (!IOT_TYPES.has(selectedDevice.device_type)) {
      setValidationError('Thiết bị này chưa hỗ trợ dự báo trong dashboard.')
      setChartData([])
      setForecastInfo(null)
      return
    }

    const range = getForecastRange(fromDate, toDate)
    if (!isValidDateText(fromDate) || !isValidDateText(toDate)) {
      setValidationError('Ngày bạn chọn chưa hợp lệ.')
      setChartData([])
      setForecastInfo(null)
      return
    }
    if (range === null || range < 1 || range > 14) {
      setValidationError('Khoảng ngày chỉ hỗ trợ từ 1 đến 14 ngày.')
      setChartData([])
      setForecastInfo(null)
      return
    }

    const from = startOfDay(`${fromDate}T00:00:00`)
    const to = startOfDay(`${toDate}T00:00:00`)
    if (to < from) {
      setValidationError('Ngày kết thúc phải lớn hơn hoặc bằng ngày bắt đầu.')
      setChartData([])
      setForecastInfo(null)
      return
    }

    setValidationError('')

    const fetchData = async () => {
      try {
        setLoading(true)
        setFetchError('')

        const today = startOfDay(new Date())
        const needsForecast = to >= today
        const forecastHorizonDays = needsForecast
          ? Math.min(14, Math.max(1, Math.floor((endOfDay(to) - today) / DAY_MS) + 1))
          : 0

        const [historyResult, forecastResult] = await Promise.allSettled([
          api.get('/api/metrics/history-by-date', {
            params: {
              metric_type: selectedDevice.device_type,
              source: selectedDevice.source,
              from_date: fromDate,
              to_date: toDate,
            },
            timeout: 45000,
          }),
          needsForecast
            ? api.get('/api/dashboard/forecast', {
                params: {
                  device_id: selectedDevice.id,
                  horizon_days: forecastHorizonDays,
                  history_days: Math.min(365, Math.max(30, range * 10)),
                },
                timeout: 90000,
              })
            : Promise.resolve({ data: null }),
        ])

        if (historyResult.status === 'rejected') {
          throw historyResult.reason
        }

        const historyMetrics = historyResult.value?.data?.data || []
        const forecastPayload = forecastResult.status === 'fulfilled' ? (forecastResult.value?.data || {}) : {}
        const predictions = (forecastPayload?.predictions || []).filter((point) => {
          const pointDate = new Date(point?.timestamp)
          if (Number.isNaN(pointDate.getTime())) return false
          return pointDate >= from && pointDate <= endOfDay(to)
        })

        setChartData(
          buildChartData({
            fromDate,
            toDate,
            historyMetrics,
            predictions,
          }),
        )

        setForecastInfo({
          method: forecastPayload.method,
          source: forecastPayload.data_source,
          historyPoints: forecastPayload.history_points,
          horizonDays: forecastPayload.horizon_days || range,
          confidenceScore: forecastPayload.confidence_score,
          qualityLabel: forecastPayload.quality_label,
          forecastMin: forecastPayload.forecast_min,
          forecastMax: forecastPayload.forecast_max,
          forecastDelta: forecastPayload.forecast_delta,
          nextPredictedValue: forecastPayload.next_predicted_value,
          fallbackReason: humanizeFallbackReason(forecastPayload.fallback_reason),
        })

        if (forecastResult.status === 'rejected') {
          console.error('Forecast request degraded:', forecastResult.reason)
          setFetchError(humanizeFetchError(forecastResult.reason))
        }
      } catch (err) {
        console.error('Failed to fetch forecast dashboard data:', err)
        setFetchError(humanizeFetchError(err))
        setChartData([])
        setForecastInfo(null)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [selectedDevice, fromDate, toDate, forecastRefreshKey])

  const handleTrainForecastModel = async () => {
    if (!selectedDevice) return

    try {
      setTrainLoading(true)
      setTrainError('')
      setTrainMessage('Đang đồng bộ dữ liệu thời tiết...')

      await api.post(`/api/model/weather-pipeline/devices/${selectedDevice.id}/sync`, null, {
        timeout: 120000,
      })

      setTrainMessage('Đang kiểm tra lại bộ dữ liệu...')
      const statusResponse = await api.get(`/api/model/tft-training/devices/${selectedDevice.id}/status`, {
        timeout: 60000,
      })
      setDatasetStatus(statusResponse?.data?.dataset || null)

      setTrainMessage('Đang huấn luyện mô hình TFT...')
      const trainResponse = await api.post(`/api/model/tft-training/devices/${selectedDevice.id}/train`, null, {
        timeout: 600000,
      })

      setTrainMessage(`Huấn luyện xong lúc ${trainResponse?.data?.created_at || 'vừa xong'}.`)

      const finalStatusResponse = await api.get(`/api/model/tft-training/devices/${selectedDevice.id}/status`, {
        timeout: 60000,
      })
      setDatasetStatus(finalStatusResponse?.data?.dataset || null)
      setForecastRefreshKey((value) => value + 1)
    } catch (err) {
      const detail = err?.response?.data?.detail
      const message = typeof detail === 'string' ? detail : detail?.message || err.message
      setTrainError(humanizeDatasetError(message || 'Huấn luyện chưa thành công.'))
      setTrainMessage('')
    } finally {
      setTrainLoading(false)
    }
  }

  const handleAddDevice = async (deviceData) => {
    try {
      setAddingDevice(true)
      await createIoTDevice(deviceData)
      setShowAddDeviceModal(false)
    } finally {
      setAddingDevice(false)
    }
  }

  return (
    <div className="min-h-screen bg-dark-900 p-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-white mb-2">Dashboard</h1>
        <p className="text-gray-400">Theo dõi nhanh thiết bị, dữ liệu thực tế và phần dự báo trong cùng một màn hình.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-dark-800 border border-neon-cyan/20 rounded-xl p-8 hover:border-neon-cyan/40 transition-all">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">IoT Devices</h2>
            <Thermometer className="w-6 h-6 text-neon-cyan" />
          </div>
          <p className="text-5xl font-bold text-neon-cyan mb-4">{devices?.length || 0}</p>
          <button
            onClick={() => setShowAddDeviceModal(true)}
            className="w-full px-4 py-2 bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/40 rounded-lg hover:bg-neon-cyan/30 transition-all flex items-center justify-center gap-2 text-sm"
          >
            <Plus className="w-4 h-4" />
            Add Device
          </button>
        </div>

        <div className="bg-dark-800 border border-neon-cyan/20 rounded-xl p-8 hover:border-neon-cyan/40 transition-all">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Servers</h2>
            <Server className="w-6 h-6 text-neon-cyan" />
          </div>
          <p className="text-5xl font-bold text-neon-cyan mb-4">{activeServers.length}</p>
          <p className="text-sm text-gray-400">Chỉ tính những server còn hoạt động.</p>
        </div>

        <div className="bg-dark-800 border border-yellow-400/20 rounded-xl p-8">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold text-white">Forecast Snapshot</h2>
            <TrendingUp className={`w-6 h-6 ${trendIsUp ? 'text-green-400' : 'text-yellow-300'}`} />
          </div>
          <p className="text-3xl font-bold text-yellow-300 mb-1">
            {forecastInfo?.nextPredictedValue ?? '--'}
          </p>
          <p className="text-sm text-gray-400">
            Mức tin cậy:{' '}
            {forecastInfo?.confidenceScore !== undefined && forecastInfo?.confidenceScore !== null
              ? `${Math.round(Number(forecastInfo.confidenceScore) * 100)}%`
              : '--'}
          </p>
        </div>
      </div>

      {devices && devices.length > 0 && (
        <div className="bg-dark-800 border border-neon-cyan/20 rounded-xl p-8">
          <div className="mb-6">
            <div>
              <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
                <TrendingUp className="w-6 h-6 text-neon-cyan" />
                Forecast View
              </h2>
              <p className="text-sm text-gray-400">
                Chọn 1 ngày để xem 24 mốc theo giờ. Chọn từ 2 ngày trở lên để xem 1 mốc cho mỗi ngày.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Sensor</label>
              <select
                value={selectedDeviceId || ''}
                onChange={(e) => setSelectedDeviceId(parseInt(e.target.value, 10))}
                className="w-full bg-dark-900 border border-gray-700 rounded-lg px-4 py-3 text-white focus:border-neon-cyan outline-none"
              >
                {devices.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.name} ({device.device_type})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">From Date</label>
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-gray-400" />
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-full bg-dark-900 border border-gray-700 rounded-lg px-4 py-3 text-white focus:border-neon-cyan outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">To Date</label>
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-gray-400" />
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-full bg-dark-900 border border-gray-700 rounded-lg px-4 py-3 text-white focus:border-neon-cyan outline-none"
                />
              </div>
            </div>
          </div>

          {validationError && (
            <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {validationError}
            </div>
          )}

          {fetchError && !validationError && (
            <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {fetchError}
            </div>
          )}

          {forecastInfo?.fallbackReason && (
            <div className="mb-4 rounded-xl border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-100 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{forecastInfo.fallbackReason}</span>
            </div>
          )}

          {loading ? (
            <div className="h-96 flex items-center justify-center text-gray-400">Loading forecast...</div>
          ) : chartData.length > 0 ? (
            <div className="rounded-2xl border border-white/10 bg-dark-900/50 p-5">
              <div className="flex items-center justify-between gap-4 mb-4">
                <div>
                  <p className="text-sm text-gray-300 font-medium">Chart Output</p>
                  <p className="text-xs text-gray-500">
                    {selectedRange === 1
                      ? 'Ngày đã chọn được hiển thị theo giờ, từ 00:00 đến 23:00.'
                      : 'Khoảng ngày đã chọn được gom theo ngày để dễ so sánh.'}
                  </p>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <span className="flex items-center gap-2 text-rose-200">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: ACTUAL_COLOR }} />
                    Recorded
                  </span>
                  <span className="flex items-center gap-2 text-yellow-100">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: FORECAST_COLOR }} />
                    Forecast
                  </span>
                </div>
              </div>

              <div className="h-96 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 10, right: 10, left: -8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.45} />
                    <XAxis dataKey="label" stroke="#94a3b8" tick={{ fontSize: 12 }} />
                    <YAxis stroke="#94a3b8" tick={{ fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#111827', border: '1px solid #1f2937', borderRadius: '12px' }}
                      labelStyle={{ color: '#f8fafc' }}
                      labelFormatter={(_, payload) => payload?.[0]?.payload?.timestamp ? formatDateTimeText(payload[0].payload.timestamp) : ''}
                      formatter={(value, name) => [
                        value === null ? '--' : `${value} ${getMetricUnit(selectedDevice?.device_type)}`.trim(),
                        name === 'actualValue' ? 'Recorded' : 'Forecast',
                      ]}
                    />
                    <Legend
                      formatter={(value) => (value === 'actualValue' ? 'Recorded' : 'Forecast')}
                    />
                    <Line
                      type="monotone"
                      dataKey="actualValue"
                      stroke={ACTUAL_COLOR}
                      strokeWidth={3}
                      dot={{ r: 4, strokeWidth: 0, fill: ACTUAL_COLOR }}
                      activeDot={{ r: 6 }}
                      connectNulls={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="forecastValue"
                      stroke={FORECAST_COLOR}
                      strokeWidth={3}
                      dot={{ r: 4, strokeWidth: 0, fill: FORECAST_COLOR }}
                      activeDot={{ r: 6 }}
                      strokeDasharray="6 6"
                      connectNulls={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <div className="h-96 rounded-2xl border border-white/10 bg-dark-900/40 flex items-center justify-center text-gray-400">
              Không có dữ liệu phù hợp cho khoảng ngày bạn đang chọn.
            </div>
          )}

          <div className="mt-4 rounded-xl border border-cyan-400/20 bg-cyan-400/5 px-4 py-3 text-sm text-cyan-100 flex items-start gap-3">
            <Sparkles className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              Quy tắc hiển thị hiện tại: ngày quá khứ và hiện tại dùng dữ liệu thực tế màu đỏ, ngày hoặc giờ tương lai dùng dự báo màu vàng.
            </span>
          </div>

          <div className="mt-4 rounded-xl border border-white/10 bg-dark-900/45">
            <button
              type="button"
              onClick={() => setShowTechnicalDetails((value) => !value)}
              className="w-full flex items-center justify-between px-4 py-3 text-left"
            >
              <div>
                <p className="text-sm font-semibold text-white">Chi tiết kỹ thuật</p>
                <p className="text-xs text-gray-400">
                  Chỉ mở khi bạn cần xem thông tin model, nguồn dữ liệu hoặc mã thiết bị.
                </p>
              </div>
              <span className="text-sm text-cyan-300">{showTechnicalDetails ? 'Ẩn' : 'Hiện'}</span>
            </button>

            {showTechnicalDetails && (
              <div className="border-t border-white/10 px-4 pb-4 pt-3">
                <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-4 mb-4">
                  <div className="bg-dark-900/70 border border-cyan-400/20 rounded-xl p-5">
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div>
                        <p className="text-xs uppercase tracking-[0.18em] text-cyan-300/80 mb-2">Training</p>
                        <h3 className="text-xl font-semibold text-white">Forecast Model for {selectedDevice?.name}</h3>
                        <p className="text-sm text-gray-400 mt-1">
                          Hệ thống sẽ đồng bộ weather cache rồi train TFT khi bạn bấm nút bên cạnh.
                        </p>
                      </div>
                      <button
                        onClick={handleTrainForecastModel}
                        disabled={trainLoading || datasetStatusLoading}
                        className="px-4 py-2 rounded-lg border border-cyan-400/40 bg-cyan-400/10 text-cyan-200 hover:bg-cyan-400/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {trainLoading ? 'Training...' : 'Train Model'}
                      </button>
                    </div>

                    {trainMessage && (
                      <div className="mb-3 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-sm text-cyan-100">
                        {trainMessage}
                      </div>
                    )}

                    {trainError && (
                      <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                        {trainError}
                      </div>
                    )}

                    {datasetStatus?.error ? (
                      <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-4 text-sm text-yellow-100">
                        {datasetStatus.error}
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        <div className="rounded-lg bg-dark-800/80 border border-white/5 px-3 py-3">
                          <p className="text-xs text-gray-400 mb-1">Data Source</p>
                          <p className="text-sm font-medium text-white">{datasetStatus?.data_provider || '--'}</p>
                        </div>
                        <div className="rounded-lg bg-dark-800/80 border border-white/5 px-3 py-3">
                          <p className="text-xs text-gray-400 mb-1">Target</p>
                          <p className="text-sm font-medium text-white">{datasetStatus?.target_column || '--'}</p>
                        </div>
                        <div className="rounded-lg bg-dark-800/80 border border-white/5 px-3 py-3">
                          <p className="text-xs text-gray-400 mb-1">Rows</p>
                          <p className="text-sm font-medium text-white">{datasetStatus?.rows ?? '--'}</p>
                        </div>
                        <div className="rounded-lg bg-dark-800/80 border border-white/5 px-3 py-3">
                          <p className="text-xs text-gray-400 mb-1">Missing</p>
                          <p className="text-sm font-medium text-white">{datasetStatus?.missing_target_rows ?? '--'}</p>
                        </div>
                        <div className="rounded-lg bg-dark-800/80 border border-white/5 px-3 py-3">
                          <p className="text-xs text-gray-400 mb-1">Encoder</p>
                          <p className="text-sm font-medium text-white">{datasetStatus?.recommended_encoder_length ?? '--'}h</p>
                        </div>
                        <div className="rounded-lg bg-dark-800/80 border border-white/5 px-3 py-3">
                          <p className="text-xs text-gray-400 mb-1">Prediction</p>
                          <p className="text-sm font-medium text-white">{datasetStatus?.recommended_prediction_length ?? '--'}h</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div className="bg-dark-900/60 border border-gray-700 rounded-lg p-4">
                    <p className="text-xs text-gray-400 mb-2">Forecast Range</p>
                    <p className="text-white font-semibold">
                      {forecastInfo?.forecastMin ?? '--'} - {forecastInfo?.forecastMax ?? '--'} {getMetricUnit(selectedDevice?.device_type)}
                    </p>
                    <p className="text-xs text-gray-400 mt-3">
                      History used: {forecastInfo?.historyPoints ?? '--'} points
                    </p>
                  </div>

                  <div className="bg-dark-900/60 border border-gray-700 rounded-lg p-4">
                    <p className="text-xs text-gray-400 mb-2">Expected Change</p>
                    <p className={`font-semibold text-2xl ${trendIsUp ? 'text-green-400' : 'text-yellow-300'}`}>
                      {forecastInfo?.forecastDelta ?? '--'}
                    </p>
                    <p className="text-xs text-gray-400 mt-3">
                      Confidence:{' '}
                      {forecastInfo?.confidenceScore !== undefined && forecastInfo?.confidenceScore !== null
                        ? `${Math.round(Number(forecastInfo.confidenceScore) * 100)}%`
                        : '--'}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
                    <p className="text-xs text-gray-400 mb-1">Model in use</p>
                    <p className="text-white font-semibold">{describeMethod(forecastInfo?.method)}</p>
                    <p className="text-sm text-gray-400 mt-1">{describeSource(forecastInfo?.source)}</p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
                    <p className="text-xs text-gray-400 mb-1">Selected output</p>
                    <p className="text-white font-semibold">{selectedRange === 1 ? '24 hourly nodes' : `${selectedRange || '--'} daily nodes`}</p>
                    <p className="text-sm text-gray-400 mt-1">
                      Past/current data is red. Future prediction is yellow.
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
                    <p className="text-xs text-gray-400 mb-1">Owner / Device</p>
                    <p className="text-white font-semibold">{user?.username || '--'}</p>
                    <p className="text-sm text-gray-400 mt-1">Device ID: {selectedDevice?.id ?? '--'}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <AddDeviceModal
        isOpen={showAddDeviceModal}
        onClose={() => setShowAddDeviceModal(false)}
        onAdd={handleAddDevice}
        isLoading={addingDevice}
      />
    </div>
  )
}
