class PolyCpp {
public:
    int run(int value) { return value; }
};

int use_poly_cpp(PolyCpp value) {
    return value.run(1);
}
