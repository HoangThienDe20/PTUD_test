import { useState } from 'react'
import { X, Plus } from 'lucide-react'

const UNIT_BY_METRIC = {
  temperature: '\u00b0C',
  humidity: '%',
}

const CATEGORY_BY_ENV = {
  indoor: 'Trong nhà',
  outdoor: 'Ngoài trời',
}

const normalizeSource = (value) => {
  const raw = (value || '').toLowerCase().trim()
  const match = raw.match(/^sensor[-_]?0*(\d+)$/)
  if (match) return `sensor_${Number(match[1])}`
  return raw
}

export default function AddDeviceModal({ isOpen, onClose, onAdd, isLoading }) {
  const [formData, setFormData] = useState({
    name: '',
    source: '',
    metric_type: 'temperature',
    location: '',
    environment_type: 'indoor',
  })
  const [error, setError] = useState('')

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
    setError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!formData.name.trim()) return setError('Device name is required')
    if (!formData.source.trim()) return setError('Source is required')
    if (!/^[a-zA-Z0-9_-]+$/.test(formData.source)) {
      return setError('Source can only contain letters, numbers, hyphens, and underscores')
    }

    const unit = UNIT_BY_METRIC[formData.metric_type]

    try {
      await onAdd({
        name: formData.name.trim(),
        source: normalizeSource(formData.source),
        metric_type: formData.metric_type,
        device_type: formData.metric_type,
        unit,
        location: formData.location.trim(),
        category: CATEGORY_BY_ENV[formData.environment_type],
        environment_type: formData.environment_type,
        min_threshold: null,
        max_threshold: null,
        alert_enabled: false,
      })

      setFormData({
        name: '',
        source: '',
        metric_type: 'temperature',
        location: '',
        environment_type: 'indoor',
      })
      setError('')
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Failed to add device')
    }
  }

  if (!isOpen) return null

  const unit = UNIT_BY_METRIC[formData.metric_type]

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-dark-800 border border-neon-cyan/30 rounded-xl p-8 max-w-md w-full mx-4">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Plus className="w-6 h-6 text-neon-cyan" />
            Add IoT Device
          </h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Device name</label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              placeholder="Living Room Temperature"
              className="w-full bg-dark-900 border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan/60 transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Source</label>
            <input
              type="text"
              name="source"
              value={formData.source}
              onChange={handleChange}
              placeholder="sensor_1 or esp32_devkit_v1"
              className="w-full bg-dark-900 border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan/60 transition-colors font-mono"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Metric type</label>
            <select
              name="metric_type"
              value={formData.metric_type}
              onChange={handleChange}
              className="w-full bg-dark-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-neon-cyan/60 transition-colors"
            >
              <option value="temperature">Temperature</option>
              <option value="humidity">Humidity</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Unit</label>
            <input
              type="text"
              value={unit}
              disabled
              className="w-full bg-dark-900 border border-gray-700 rounded-lg px-4 py-2 text-gray-300 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Location</label>
            <input
              type="text"
              name="location"
              value={formData.location}
              onChange={handleChange}
              placeholder="nha"
              className="w-full bg-dark-900 border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan/60 transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Category</label>
            <select
              name="environment_type"
              value={formData.environment_type}
              onChange={handleChange}
              className="w-full bg-dark-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-neon-cyan/60 transition-colors"
            >
              <option value="indoor">Trong nhà</option>
              <option value="outdoor">Ngoài trời</option>
            </select>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-all">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex-1 px-4 py-2 bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/40 rounded-lg hover:border-neon-cyan transition-all disabled:opacity-50"
            >
              {isLoading ? 'Adding...' : 'Add Device'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
