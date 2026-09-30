library;

import 'dart:convert';
import 'package:http/http.dart' as http;

class SearchForgeException implements Exception {
  final int status;
  final String code;
  final String message;
  final String? requestId;
  const SearchForgeException(this.status, this.code, this.message, this.requestId);
  @override
  String toString() => 'SearchForgeException($status, $code): $message';
}

class SearchResult {
  final String query;
  final double processingTimeMs;
  final int total;
  final String indexVersion;
  final List<Map<String, dynamic>> hits;
  final Map<String, dynamic> facets;
  final String? nextCursor;
  final String? searchEventId;
  SearchResult.fromJson(Map<String, dynamic> json)
      : query = json['query'] as String,
        processingTimeMs = (json['processingTimeMs'] as num).toDouble(),
        total = json['total'] as int,
        indexVersion = json['indexVersion'] as String,
        hits = (json['hits'] as List).map((hit) => Map<String, dynamic>.from(hit as Map)).toList(),
        facets = Map<String, dynamic>.from(json['facets'] as Map),
        nextCursor = json['nextCursor'] as String?,
        searchEventId = json['searchEventId'] as String?;
}

/// Use search-only keys in apps. Administrative credentials belong on servers.
/// Tenant access is determined by the server's project-scoped API key.
class SearchForgeClient {
  final String projectId;
  final String apiKey;
  final Uri _baseUrl;
  final String indexSlug;
  final Duration timeout;
  final http.Client _client;
  final bool _ownsClient;

  SearchForgeClient({
    required this.projectId,
    required this.apiKey,
    required String baseUrl,
    this.indexSlug = 'docs',
    this.timeout = const Duration(seconds: 10),
    http.Client? client,
  }) : _baseUrl = Uri.parse(baseUrl),
       _client = client ?? http.Client(),
       _ownsClient = client == null {
    if (!['http', 'https'].contains(_baseUrl.scheme) || _baseUrl.host.isEmpty ||
        _baseUrl.userInfo.isNotEmpty || _baseUrl.hasQuery || _baseUrl.hasFragment) {
      throw ArgumentError('baseUrl must be an HTTP(S) URL without credentials, query or fragment');
    }
    if (projectId.isEmpty || apiKey.isEmpty || timeout <= Duration.zero) {
      throw ArgumentError('projectId, apiKey and a positive timeout are required');
    }
  }

  String get _indexPath => '/v1/indexes/${Uri.encodeComponent(indexSlug)}';

  Future<Map<String, dynamic>> _request(String path, String method, {
    Map<String, dynamic>? body, Map<String, String>? query,
  }) async {
    final base = _baseUrl.toString().replaceFirst(RegExp(r'/$'), '');
    final uri = Uri.parse('$base$path').replace(queryParameters: query);
    final request = http.Request(method, uri);
    request.headers['Authorization'] = 'Bearer $apiKey';
    if (body != null) {
      request.headers['Content-Type'] = 'application/json';
      request.body = jsonEncode(body);
    }
    final response = await (() async {
      final stream = await _client.send(request);
      return http.Response.fromStream(stream);
    })().timeout(timeout);
    Map<String, dynamic> decoded = {};
    if (response.body.isNotEmpty) {
      try { decoded = jsonDecode(response.body) as Map<String, dynamic>; }
      on FormatException {
        if (response.statusCode >= 200 && response.statusCode < 300) rethrow;
      }
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final error = decoded['error'] as Map<String, dynamic>?;
      throw SearchForgeException(response.statusCode, error?['code'] as String? ?? 'HTTP_ERROR',
          error?['message'] as String? ?? 'Request failed (${response.statusCode})', error?['requestId'] as String?);
    }
    return decoded;
  }

  Future<SearchResult> search({
    required String query,
    Map<String, dynamic>? filters,
    List<String>? facets,
    Map<String, String>? sort,
    int limit = 20,
    int offset = 0,
    String? cursor,
    bool? typoTolerance,
    bool debug = false,
  }) async => SearchResult.fromJson(await _request('$_indexPath/search', 'POST', body: {
    'query': query, 'limit': limit, 'offset': offset, 'debug': debug,
    if (filters != null) 'filters': filters,
    if (facets != null) 'facets': facets,
    if (sort != null) 'sort': sort,
    if (cursor != null) 'cursor': cursor,
    if (typoTolerance != null) 'typoTolerance': typoTolerance,
  }));

  Future<List<Map<String, dynamic>>> autocomplete({required String query, int limit = 8}) async {
    final result = await _request('$_indexPath/autocomplete', 'GET', query: {'q': query, 'limit': '$limit'});
    return (result['suggestions'] as List).map((value) => Map<String, dynamic>.from(value as Map)).toList();
  }

  Future<void> trackClick({required String query, required String documentId,
    required int position, String? searchEventId}) async {
    await _request('/v1/analytics/click', 'POST', body: {
      'query': query, 'documentId': documentId, 'position': position,
      if (searchEventId != null) 'searchEventId': searchEventId,
    });
  }

  /// Close only a transport created by this instance; caller-owned clients remain reusable.
  void close() { if (_ownsClient) _client.close(); }
}
