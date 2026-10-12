import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:livekit_client/livekit_client.dart' hide ChatMessage;

import 'chat_controller.dart';

class ChatPage extends StatefulWidget {
  const ChatPage({super.key});

  @override
  State<ChatPage> createState() => _ChatPageState();
}

class _ChatPageState extends State<ChatPage> {
  final _controller = ChatController();
  final _input = TextEditingController();
  final _scroll = ScrollController();

  @override
  void initState() {
    super.initState();
    _controller.addListener(_onChange);
    _controller.load();
  }

  void _onChange() {
    setState(() {});
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.jumpTo(_scroll.position.maxScrollExtent);
      }
    });
  }

  @override
  void dispose() {
    _controller.removeListener(_onChange);
    _controller.dispose();
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final text = _input.text;
    _input.clear();
    await _controller.sendText(text);
  }

  Widget _deviceMenu({
    required IconData icon,
    required List<MediaDevice> devices,
    required String? selectedId,
    required Future<void> Function(MediaDevice device) onSelected,
  }) {
    return PopupMenuButton<String>(
      tooltip: '音频设备',
      icon: Icon(icon, color: Colors.white),
      onSelected: (id) {
        final device = devices.where((item) => item.deviceId == id).firstOrNull;
        if (device != null) onSelected(device);
      },
      itemBuilder: (context) {
        if (devices.isEmpty) {
          return const [PopupMenuItem(enabled: false, child: Text('没有可用设备'))];
        }
        return [
          for (final device in devices)
            PopupMenuItem(
              value: device.deviceId,
              child: Text(
                device.label.isEmpty ? '默认设备' : device.label,
                style: TextStyle(fontWeight: device.deviceId == selectedId ? FontWeight.w700 : FontWeight.normal),
              ),
            ),
        ];
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFEDEDED),
      appBar: AppBar(
        backgroundColor: const Color(0xFFEDEDED),
        elevation: 0.5,
        title: const Text('助手', style: TextStyle(color: Colors.black, fontSize: 17)),
        centerTitle: true,
        actions: [
          IconButton(
            tooltip: '新会话',
            onPressed: _controller.newConversation,
            icon: const Icon(Icons.add_comment_outlined, color: Colors.black87),
          ),
        ],
      ),
      body: Column(
        children: [
          if (_controller.inCall)
            Material(
              color: const Color(0xFF07C160),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                child: Row(
                  children: [
                    const Expanded(
                      child: Text(
                        '语音通话中，可以直接说话打断',
                        style: TextStyle(color: Colors.white, fontSize: 13),
                      ),
                    ),
                    _deviceMenu(
                      icon: Icons.mic,
                      devices: _controller.audioInputs,
                      selectedId: _controller.inputDeviceId,
                      onSelected: _controller.selectInput,
                    ),
                    _deviceMenu(
                      icon: Icons.volume_up,
                      devices: _controller.audioOutputs,
                      selectedId: _controller.outputDeviceId,
                      onSelected: _controller.selectOutput,
                    ),
                  ],
                ),
              ),
            ),
          if (_controller.banner != null)
            Material(
              color: const Color(0xFFFFF3CD),
              child: SizedBox(
                width: double.infinity,
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 12),
                  child: Text(_controller.banner!, style: const TextStyle(color: Color(0xFF8A6D3B))),
                ),
              ),
            ),
          Expanded(
            child: ListView.builder(
              controller: _scroll,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              itemCount: _controller.messages.length,
              itemBuilder: (context, index) {
                final message = _controller.messages[index];
                final mine = message.role == 'user';
                return Align(
                  alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
                  child: Container(
                    margin: const EdgeInsets.only(bottom: 10),
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    constraints: const BoxConstraints(maxWidth: 420),
                    decoration: BoxDecoration(
                      color: mine ? const Color(0xFF95EC69) : Colors.white,
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Column(
                      crossAxisAlignment: mine ? CrossAxisAlignment.end : CrossAxisAlignment.start,
                      children: [
                        Text(message.text, style: const TextStyle(fontSize: 16, height: 1.35)),
                        if (message.latency != null)
                          Padding(
                            padding: const EdgeInsets.only(top: 4),
                            child: Text(
                              message.latency!,
                              style: TextStyle(fontSize: 11, height: 1.3, color: Colors.black.withValues(alpha: 0.45)),
                            ),
                          ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
          Material(
            color: const Color(0xFFF7F7F7),
            child: SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(8, 8, 8, 8),
                child: Row(
                  children: [
                    IconButton(
                      onPressed: _controller.toggleCall,
                      icon: Icon(_controller.inCall ? Icons.call_end : Icons.mic_none),
                      color: _controller.inCall ? Colors.red : const Color(0xFF181818),
                    ),
                    Expanded(
                      child: TextField(
                        controller: _input,
                        minLines: 1,
                        maxLines: 4,
                        textInputAction: TextInputAction.send,
                        inputFormatters: [_EnterToSend(_send)],
                        decoration: InputDecoration(
                          filled: true,
                          fillColor: Colors.white,
                          hintText: _controller.inCall ? '通话中也可以打字' : '输入消息',
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(6),
                            borderSide: BorderSide.none,
                          ),
                          contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                        ),
                        onSubmitted: (_) => _send(),
                      ),
                    ),
                    const SizedBox(width: 8),
                    FilledButton(
                      style: FilledButton.styleFrom(
                        backgroundColor: const Color(0xFF07C160),
                        foregroundColor: Colors.white,
                      ),
                      onPressed: _controller.sending ? null : _send,
                      child: const Text('发送'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _EnterToSend extends TextInputFormatter {
  _EnterToSend(this.onSubmit);

  final VoidCallback onSubmit;

  @override
  TextEditingValue formatEditUpdate(TextEditingValue oldValue, TextEditingValue newValue) {
    final insertedNewline = newValue.text.length == oldValue.text.length + 1 && newValue.text.endsWith('\n');
    if (insertedNewline && !HardwareKeyboard.instance.isShiftPressed) {
      WidgetsBinding.instance.addPostFrameCallback((_) => onSubmit());
      return oldValue;
    }
    return newValue;
  }
}
