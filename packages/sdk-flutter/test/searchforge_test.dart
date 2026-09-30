import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:searchforge/searchforge.dart';
import 'package:test/test.dart';

void main() {
  test('Arabic query, filters, facets and cursor survive the wire', () async {
    final transport = MockClient((request) async {
      expect(request.url.path, '/v1/indexes/docs/search');
      expect(request.headers['Authorization'], 'Bearer search-key');
      final body = jsonDecode(request.body) as Map<String, dynamic>;
      expect(body['query'], 'بحث search');
      expect(body['cursor'], 'opaque-v17');
      expect(body['filters'], {'published': true});
      return http.Response(jsonEncode({'query': 'بحث search', 'processingTimeMs': 1.25,
        'total': 1, 'indexVersion': '17', 'hits': [], 'facets': {}, 'nextCursor': 'next',
        'searchEventId': 'event'}), 200, headers: {'content-type': 'application/json; charset=utf-8'});
    });
    final client = SearchForgeClient(projectId: 'p', apiKey: 'search-key', baseUrl: 'https://search.example', client: transport);
    final result = await client.search(query: 'بحث search', filters: {'published': true}, cursor: 'opaque-v17');
    expect(result.indexVersion, '17');
    expect(result.nextCursor, 'next');
    expect(result.processingTimeMs, 1.25);
    transport.close();
  });
  test('preserves structured API errors', () async {
    final transport = MockClient((_) async => http.Response(jsonEncode({'error': {
      'code': 'RATE_LIMITED', 'message': 'Slow down', 'requestId': 'req'}}), 429));
    final client = SearchForgeClient(projectId: 'p', apiKey: 'key', baseUrl: 'https://search.example', client: transport);
    await expectLater(client.search(query: 'x'), throwsA(isA<SearchForgeException>()
      .having((error) => error.code, 'code', 'RATE_LIMITED')
      .having((error) => error.requestId, 'requestId', 'req')));
    transport.close();
  });
  test('autocomplete encodes Unicode and click tracking retains event ID', () async {
    final transport = MockClient((request) async {
      if (request.method == 'GET') {
        expect(request.url.queryParameters['q'], 'بحث &');
        return http.Response('{"suggestions":[{"value":"بحث","score":2}]}', 200,
          headers: {'content-type': 'application/json; charset=utf-8'});
      }
      expect(jsonDecode(request.body)['searchEventId'], 'event');
      return http.Response('{"accepted":true}', 202);
    });
    final client = SearchForgeClient(projectId: 'p', apiKey: 'key', baseUrl: 'https://search.example', client: transport);
    expect((await client.autocomplete(query: 'بحث &')).first['value'], 'بحث');
    await client.trackClick(query: 'بحث', documentId: 'doc', position: 1, searchEventId: 'event');
    transport.close();
  });
}
