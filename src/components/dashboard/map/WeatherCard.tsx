import React, { useState, useEffect } from 'react';
import { fetchProvinceWeatherForecast } from '../../../services/bmkgService';
import type { WeatherData } from '../../../types/weather';
import {
  Warning as WarningIcon,
  WaterDrop as WaterDropIcon,
  Air as AirIcon
} from '@mui/icons-material';

interface WeatherCardProps {
  provinceId: string;
  cityName: string;
}

export const WeatherCard: React.FC<WeatherCardProps> = ({ provinceId, cityName }) => {
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDayIdx, setSelectedDayIdx] = useState<number>(0);

  useEffect(() => {
    let active = true;
    const loadWeather = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchProvinceWeatherForecast(provinceId);
        if (active) {
          setWeatherData(data);
          setSelectedDayIdx(0);
        }
      } catch (err: unknown) {
        if (active) {
          setError(err instanceof Error && err.message ? err.message : 'Gagal memuat cuaca');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadWeather();
    return () => {
      active = false;
    };
  }, [provinceId]);

  if (loading) {
    return (
      <div className="weather-card-loading">
        <div className="weather-spinner" />
        <span>Memuat cuaca BMKG...</span>
      </div>
    );
  }

  if (error || !weatherData || !weatherData.cuaca || weatherData.cuaca.length === 0) {
    return (
      <div className="weather-card-error" style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center' }}>
        <WarningIcon style={{ fontSize: 16, color: '#d97706' }} />
        <span>Cuaca tidak tersedia untuk wilayah ini</span>
      </div>
    );
  }

  const { lokasi, cuaca } = weatherData;
  
  // Find current weather (the first available item in Day 0, or fallback)
  const currentDayForecasts = cuaca[0] || [];
  const currentItem = currentDayForecasts[0] || (cuaca[1] && cuaca[1][0]);

  if (!currentItem) {
    return (
      <div className="weather-card-error" style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center' }}>
        <WarningIcon style={{ fontSize: 16, color: '#d97706' }} />
        <span>Data prakiraan cuaca kosong</span>
      </div>
    );
  }

  // Helper to format date label
  const getDayLabel = (idx: number, dateStr: string) => {
    if (idx === 0) return 'Hari Ini';
    if (idx === 1) return 'Besok';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });
    } catch {
      return `Hari ${idx + 1}`;
    }
  };

  const selectedDayForecasts = cuaca[selectedDayIdx] || [];

  return (
    <div className="weather-card-container">
      {/* Header */}
      <div className="weather-card-header">
        <div className="weather-loc-info">
          <span className="weather-loc-label">Prakiraan Cuaca BMKG</span>
          <span className="weather-loc-city">{lokasi.kotkab || cityName}</span>
        </div>
        <div className="weather-current-temp-wrap">
          <img 
            src={currentItem.image} 
            alt={currentItem.weather_desc} 
            className="weather-current-icon"
            onError={(e) => {
              // Fallback if image fails to load
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
          <div className="weather-current-text">
            <span className="weather-current-temp">{currentItem.t}°C</span>
            <span className="weather-current-desc">{currentItem.weather_desc}</span>
          </div>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="weather-metrics-grid">
        <div className="weather-metric-item" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="weather-metric-emoji" style={{ display: 'inline-flex', alignItems: 'center' }}><WaterDropIcon style={{ fontSize: 16, color: '#0284c7' }} /></span>
          <div className="weather-metric-info">
            <span className="weather-metric-val">{currentItem.hu}%</span>
            <span className="weather-metric-label">Kelembapan</span>
          </div>
        </div>
        <div className="weather-metric-item" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="weather-metric-emoji" style={{ display: 'inline-flex', alignItems: 'center' }}><AirIcon style={{ fontSize: 16, color: '#64748b' }} /></span>
          <div className="weather-metric-info">
            <span className="weather-metric-val">{currentItem.ws} km/h</span>
            <span className="weather-metric-label">Angin ({currentItem.wd})</span>
          </div>
        </div>
      </div>

      {/* Day Selector Tabs */}
      <div className="weather-day-tabs">
        {cuaca.map((dayForecasts, idx) => {
          if (dayForecasts.length === 0) return null;
          const label = getDayLabel(idx, dayForecasts[0].datetime);
          return (
            <button
              key={idx}
              className={`weather-day-tab ${selectedDayIdx === idx ? 'active' : ''}`}
              onClick={() => setSelectedDayIdx(idx)}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Hourly Timeline */}
      <div className="weather-hourly-timeline">
        {selectedDayForecasts.map((item, idx) => {
          const date = new Date(item.datetime);
          const timeLabel = date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false });
          return (
            <div key={idx} className="weather-hourly-item">
              <span className="weather-hourly-time">{timeLabel}</span>
              <img 
                src={item.image} 
                alt={item.weather_desc} 
                className="weather-hourly-icon"
              />
              <span className="weather-hourly-temp">{item.t}°C</span>
              <span className="weather-hourly-desc">{item.weather_desc}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default WeatherCard;
