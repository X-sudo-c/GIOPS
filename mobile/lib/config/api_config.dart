/// Default local dev URLs (Android emulator uses 10.0.2.2 for host machine).
class ApiConfig {
  ApiConfig({
    required this.syncBaseUrl,
    required this.ocrBaseUrl,
    required this.supabaseUrl,
    required this.supabaseAnonKey,
    this.martinBaseUrl = 'http://127.0.0.1:3001',
  });

  final String syncBaseUrl;
  final String ocrBaseUrl;
  final String supabaseUrl;
  final String supabaseAnonKey;
  final String martinBaseUrl;

  static const defaultAnonKey =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

  /// Defaults tuned for Android emulator → host services.
  factory ApiConfig.androidEmulator() => ApiConfig(
        syncBaseUrl: 'http://10.0.2.2:5000',
        ocrBaseUrl: 'http://10.0.2.2:5002',
        supabaseUrl: 'http://10.0.2.2:54321',
        supabaseAnonKey: defaultAnonKey,
        martinBaseUrl: 'http://10.0.2.2:3001',
      );

  factory ApiConfig.localhost() => ApiConfig(
        syncBaseUrl: 'http://127.0.0.1:5000',
        ocrBaseUrl: 'http://127.0.0.1:5002',
        supabaseUrl: 'http://127.0.0.1:54321',
        supabaseAnonKey: defaultAnonKey,
      );

  ApiConfig copyWith({
    String? syncBaseUrl,
    String? ocrBaseUrl,
    String? supabaseUrl,
    String? supabaseAnonKey,
    String? martinBaseUrl,
  }) {
    return ApiConfig(
      syncBaseUrl: syncBaseUrl ?? this.syncBaseUrl,
      ocrBaseUrl: ocrBaseUrl ?? this.ocrBaseUrl,
      supabaseUrl: supabaseUrl ?? this.supabaseUrl,
      supabaseAnonKey: supabaseAnonKey ?? this.supabaseAnonKey,
      martinBaseUrl: martinBaseUrl ?? this.martinBaseUrl,
    );
  }

  Map<String, String> toJson() => {
        'syncBaseUrl': syncBaseUrl,
        'ocrBaseUrl': ocrBaseUrl,
        'supabaseUrl': supabaseUrl,
        'supabaseAnonKey': supabaseAnonKey,
        'martinBaseUrl': martinBaseUrl,
      };

  factory ApiConfig.fromJson(Map<String, dynamic> json) => ApiConfig(
        syncBaseUrl: json['syncBaseUrl'] as String,
        ocrBaseUrl: json['ocrBaseUrl'] as String,
        supabaseUrl: json['supabaseUrl'] as String,
        supabaseAnonKey: json['supabaseAnonKey'] as String,
        martinBaseUrl: json['martinBaseUrl'] as String? ?? 'http://127.0.0.1:3001',
      );
}
