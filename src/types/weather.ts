export interface WeatherItem {
  datetime: string;
  t: number;
  weather_desc: string;
  weather_desc_en: string;
  ws: number;
  wd: string;
  hu: number;
  image: string;
  local_datetime: string;
}

export interface WeatherData {
  lokasi: {
    provinsi: string;
    kotkab: string;
    kecamatan: string;
    desa: string;
    timezone: string;
  };
  cuaca: WeatherItem[][];
}
