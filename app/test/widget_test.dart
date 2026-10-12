import 'package:flutter_test/flutter_test.dart';
import 'package:liveai_app/main.dart';

void main() {
  testWidgets('shows the chat title', (tester) async {
    await tester.pumpWidget(const LiveAiApp());
    expect(find.text('助手'), findsOneWidget);
  });
}
