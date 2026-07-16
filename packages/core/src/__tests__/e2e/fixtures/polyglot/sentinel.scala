class PolyScala {
  def run(value: Int): Int = value
}

def usePolyScala(value: PolyScala): Int = value.run(1)
