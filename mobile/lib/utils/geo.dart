import 'package:latlong2/latlong.dart';

bool isFiniteLatLng(double latitude, double longitude) {
  return latitude.isFinite &&
      longitude.isFinite &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180;
}

bool isValidLatLng(LatLng point) =>
    isFiniteLatLng(point.latitude, point.longitude);

LatLng? latLngIfValid(double? latitude, double? longitude) {
  if (latitude == null || longitude == null) return null;
  if (!isFiniteLatLng(latitude, longitude)) return null;
  return LatLng(latitude, longitude);
}
