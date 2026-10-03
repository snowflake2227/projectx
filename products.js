// Products data with more items for better testing
const products = [
    {
        id: 1,
        name: "vendeta t-shirt",
        price: 2499,
        image: "images/products/front.jpg", // основное изображение
        images: [
            "images/products/front.jpg", // передняя часть - индекс 0
            "images/products/back.jpg"   // задняя часть - индекс 1
        ],
        description: "Оверсайз футболка из кулирной глади премиального качества(хлопок 94% лайкра 6%)"
    }
];

// Helper function to get product by ID
function getProductById(id) {
    return products.find(product => product.id === id);
}