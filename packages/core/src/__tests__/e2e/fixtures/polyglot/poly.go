package poly

func PolyGo(n int) int {
	return n + 1
}

func usePolyGo() int {
	return PolyGo(1)
}

type PolyStruct struct {
	ID int
}
