import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

class ChatMessage {
  ChatMessage({
    required this.id,
    required this.role,
    required this.text,
  });

  final String id;
  final String role;
  String text;
  String? latency;
}

class ChatChunk {
  ChatChunk({this.text, this.latency});

  final String? text;
  final String? latency;
}

String formatLatency(Map latency) {
  String part(String label, Object? value) {
    if (value is! num) return '$label —';
    return '$label ${(value / 1000).toStringAsFixed(2)}s';
  }

  return '${part('端到端', latency['e2e'])}  ${part('STT', latency['stt'])}  ${part('LLM', latency['llm'])}  ${part('TTS', latency['tts'])}';
}

class ApiException implements Exception {
  ApiException(this.message);
  final String message;

  @override
  String toString() => message;
}

class LiveAiApi {
  LiveAiApi({this.baseUrl = 'http://127.0.0.1:3000'});

  final String baseUrl;

  Future<List<ChatMessage>> messages(String threadId) async {
    final response = await http.get(Uri.parse('$baseUrl/threads/$threadId/messages'));
    final body = jsonDecode(response.body);
    if (response.statusCode >= 400) {
      throw ApiException(body is Map && body['error'] is String ? body['error'] as String : '读取对话失败');
    }
    final list = (body as Map)['messages'] as List<dynamic>? ?? [];
    return list.map((item) {
      final map = item as Map<String, dynamic>;
      return ChatMessage(
        id: map['id'] as String? ?? '',
        role: map['role'] as String? ?? 'assistant',
        text: map['text'] as String? ?? '',
      );
    }).toList();
  }

  Stream<ChatChunk> sendText({
    required String threadId,
    required String resourceId,
    required String text,
  }) async* {
    final request = http.Request('POST', Uri.parse('$baseUrl/chat'));
    request.headers['content-type'] = 'application/json';
    request.body = jsonEncode({
      'threadId': threadId,
      'resourceId': resourceId,
      'text': text,
    });
    final response = await request.send();
    if (response.statusCode >= 400) {
      final raw = await response.stream.bytesToString();
      throw ApiException(raw.isEmpty ? '发送失败' : raw);
    }
    var pending = '';
    await for (final chunk in response.stream.transform(utf8.decoder)) {
      pending += chunk;
      final lines = pending.split('\n');
      pending = lines.removeLast();
      for (final line in lines) {
        final trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        final payload = jsonDecode(trimmed.substring(5).trim()) as Map<String, dynamic>;
        if (payload['error'] is String) throw ApiException(payload['error'] as String);
        final latency = payload['latency'];
        if (latency is Map) {
          yield ChatChunk(latency: formatLatency(latency));
        }
        if (payload['delta'] is String) yield ChatChunk(text: payload['delta'] as String);
      }
    }
  }

  Future<ConnectionDetails> connectionDetails({
    required String threadId,
    required String resourceId,
  }) async {
    final response = await http.post(
      Uri.parse('$baseUrl/voice/livekit/connection-details'),
      headers: {'content-type': 'application/json'},
      body: jsonEncode({'threadId': threadId, 'resourceId': resourceId}),
    );
    final body = jsonDecode(response.body);
    if (response.statusCode >= 400) {
      throw ApiException(body is Map && body['error'] is String ? body['error'] as String : '无法开始语音');
    }
    final map = body as Map<String, dynamic>;
    return ConnectionDetails(
      serverUrl: map['serverUrl'] as String,
      participantToken: map['participantToken'] as String,
    );
  }
}

class ConnectionDetails {
  ConnectionDetails({required this.serverUrl, required this.participantToken});

  final String serverUrl;
  final String participantToken;
}
