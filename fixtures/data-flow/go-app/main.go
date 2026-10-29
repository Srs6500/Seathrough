package main

func main() {
	r.GET("/orders", listOrders)
	http.HandleFunc("/health", health)
}
