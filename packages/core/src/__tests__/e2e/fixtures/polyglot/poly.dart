// E9: Dart file with a class + method. The symbol extractor recognizes Dart
// class/method declarations but Dart imports are not parsed → the file lands in
// the symbol graph with no incoming/outgoing import edges (PageRank-disconnected).

class PolyDart {
  final String name;

  PolyDart(this.name);

  String greet() {
    return 'Hello $name';
  }
}

int polyTopLevel(int n) {
  return PolyDart('poly').greet().length + n;
}
