// Kotlin native structural fixture: class, function, and companion object.

package poly.fixture

class PolyKotlin(val id: Int) {
    fun describe(): String = "poly-$id"

    companion object {
        const val LABEL = "poly"
    }
}

fun polyTopLevel(s: String): Int = s.length

fun makePolyKotlin(): PolyKotlin = PolyKotlin(1)
