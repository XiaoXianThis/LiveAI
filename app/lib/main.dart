import 'package:flutter/material.dart';

import 'chat_page.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const LiveAiApp());
}

class LiveAiApp extends StatelessWidget {
  const LiveAiApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'LiveAI',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF07C160)),
        useMaterial3: true,
      ),
      home: const ChatPage(),
    );
  }
}
