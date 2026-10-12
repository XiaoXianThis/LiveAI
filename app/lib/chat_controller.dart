import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:livekit_client/livekit_client.dart' hide ChatMessage;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

import 'api.dart';

class ChatController extends ChangeNotifier {
  ChatController({LiveAiApi? api}) : _api = api ?? LiveAiApi();

  final LiveAiApi _api;
  final messages = <ChatMessage>[];
  String threadId = '';
  String resourceId = 'local-user';
  bool sending = false;
  bool inCall = false;
  String? banner;
  List<MediaDevice> audioInputs = [];
  List<MediaDevice> audioOutputs = [];
  String? inputDeviceId;
  String? outputDeviceId;
  Room? _room;
  EventsListener<ParticipantEvent>? _localListener;
  TranscriptionStreamReceiver? _transcripts;
  StreamSubscription<ReceivedMessage>? _transcriptSub;
  static const _listeningId = 'listening';

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    threadId = prefs.getString('threadId') ?? const Uuid().v4();
    resourceId = prefs.getString('resourceId') ?? 'local-user';
    await prefs.setString('threadId', threadId);
    await prefs.setString('resourceId', resourceId);
    inputDeviceId = prefs.getString('inputDeviceId');
    outputDeviceId = prefs.getString('outputDeviceId');
    try {
      messages
        ..clear()
        ..addAll(await _api.messages(threadId));
    } on ApiException catch (error) {
      banner = error.message;
    }
    notifyListeners();
  }

  Future<void> newConversation() async {
    if (inCall) await toggleCall();
    final prefs = await SharedPreferences.getInstance();
    threadId = const Uuid().v4();
    await prefs.setString('threadId', threadId);
    messages.clear();
    banner = null;
    notifyListeners();
  }

  Future<void> refreshDevices() async {
    audioInputs = await Hardware.instance.audioInputs();
    audioOutputs = await Hardware.instance.audioOutputs();
    inputDeviceId ??= audioInputs.where((device) => device.deviceId.isNotEmpty).firstOrNull?.deviceId;
    outputDeviceId ??= audioOutputs.where((device) => device.deviceId.isNotEmpty).firstOrNull?.deviceId;
    notifyListeners();
  }

  Future<void> selectInput(MediaDevice device) async {
    inputDeviceId = device.deviceId;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('inputDeviceId', device.deviceId);
    final room = _room;
    if (room != null) {
      await room.setAudioInputDevice(device);
      await room.localParticipant?.setMicrophoneEnabled(false);
      await room.localParticipant?.setMicrophoneEnabled(
        true,
        audioCaptureOptions: AudioCaptureOptions(deviceId: device.deviceId),
      );
    } else {
      await Hardware.instance.selectAudioInput(device);
    }
    notifyListeners();
  }

  Future<void> selectOutput(MediaDevice device) async {
    outputDeviceId = device.deviceId;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('outputDeviceId', device.deviceId);
    final room = _room;
    if (room != null) {
      await room.setAudioOutputDevice(device);
    } else {
      await Hardware.instance.selectAudioOutput(device);
    }
    notifyListeners();
  }

  Future<void> sendText(String text) async {
    final trimmed = text.trim();
    if (trimmed.isEmpty || sending) return;
    banner = null;
    if (inCall) {
      messages.add(ChatMessage(id: const Uuid().v4(), role: 'user', text: trimmed));
      notifyListeners();
      await _room?.localParticipant?.sendText(trimmed, options: SendTextOptions(topic: 'lk.chat'));
      return;
    }
    sending = true;
    final assistant = ChatMessage(id: const Uuid().v4(), role: 'assistant', text: '');
    messages.add(ChatMessage(id: const Uuid().v4(), role: 'user', text: trimmed));
    messages.add(assistant);
    notifyListeners();
    try {
      await for (final chunk in _api.sendText(threadId: threadId, resourceId: resourceId, text: trimmed)) {
        if (chunk.text != null) assistant.text += chunk.text!;
        if (chunk.latency != null) assistant.latency = chunk.latency;
        notifyListeners();
      }
      if (assistant.text.isEmpty) messages.remove(assistant);
    } on ApiException catch (error) {
      banner = error.message;
      if (assistant.text.isEmpty) messages.remove(assistant);
    } finally {
      sending = false;
      notifyListeners();
    }
  }

  Future<void> toggleCall() async {
    if (inCall) {
      await _transcriptSub?.cancel();
      _transcriptSub = null;
      await _transcripts?.dispose();
      _transcripts = null;
      _room?.unregisterTextStreamHandler('latency');
      await _localListener?.dispose();
      _localListener = null;
      await _room?.disconnect();
      await _room?.dispose();
      _room = null;
      inCall = false;
      await _reload();
      notifyListeners();
      return;
    }
    banner = null;
    notifyListeners();
    try {
      final details = await _api.connectionDetails(threadId: threadId, resourceId: resourceId);
      final room = Room();
      await room.connect(details.serverUrl, details.participantToken);
      await refreshDevices();
      final input = audioInputs.where((device) => device.deviceId == inputDeviceId).firstOrNull;
      if (input != null) await Hardware.instance.selectAudioInput(input);
      final output = audioOutputs.where((device) => device.deviceId == outputDeviceId).firstOrNull;
      if (output != null) await room.setAudioOutputDevice(output);
      await room.localParticipant?.setMicrophoneEnabled(
        true,
        audioCaptureOptions: AudioCaptureOptions(deviceId: inputDeviceId),
      );
      await refreshDevices();
      _transcripts = TranscriptionStreamReceiver(room: room);
      _transcriptSub = _transcripts!.messages().listen((message) {
        final mine = message.content is UserTranscript;
        _upsertMessage(message.id, mine ? 'user' : 'assistant', message.content.text);
      });
      room.registerTextStreamHandler('latency', (reader, _) {
        reader.listen((chunk) {
          final text = String.fromCharCodes(chunk.content);
          if (text.isEmpty) return;
          final payload = jsonDecode(text);
          if (payload is Map) _attachLatency(formatLatency(payload));
        });
      });
      final local = room.localParticipant;
      if (local != null) {
        _localListener = local.createListener()
          ..on<SpeakingChangedEvent>((event) {
            _setListening(event.speaking);
          });
      }
      _room = room;
      inCall = true;
    } on ApiException catch (error) {
      banner = error.message;
    } catch (error) {
      banner = '连接语音失败：$error';
    }
    notifyListeners();
  }

  void _setListening(bool speaking) {
    final index = messages.indexWhere((message) => message.id == _listeningId);
    if (speaking) {
      if (index < 0) {
        messages.add(ChatMessage(id: _listeningId, role: 'user', text: '正在听…'));
      }
    } else if (index >= 0 && messages[index].text == '正在听…') {
      messages.removeAt(index);
    }
    notifyListeners();
  }

  void _upsertMessage(String id, String role, String text) {
    final trimmed = text.trim();
    if (id.isEmpty || trimmed.isEmpty) return;
    if (role == 'user') {
      final listening = messages.indexWhere((message) => message.id == _listeningId);
      if (listening >= 0) messages.removeAt(listening);
    }
    final index = messages.indexWhere((message) => message.id == id);
    if (index >= 0) {
      messages[index].text = trimmed;
    } else if (!messages.any((message) => message.role == role && message.text == trimmed)) {
      messages.add(ChatMessage(id: id, role: role, text: trimmed));
    }
    notifyListeners();
  }

  void _attachLatency(String latency) {
    for (var index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role != 'assistant') continue;
      messages[index].latency = latency;
      notifyListeners();
      return;
    }
  }

  Future<void> _reload() async {
    try {
      messages
        ..clear()
        ..addAll(await _api.messages(threadId));
    } on ApiException catch (error) {
      banner = error.message;
    }
  }

  @override
  void dispose() {
    _transcriptSub?.cancel();
    _transcripts?.dispose();
    _room?.dispose();
    super.dispose();
  }
}
